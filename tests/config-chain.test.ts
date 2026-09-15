import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import type { IsolatedDb } from "./helpers/isolated-db";
import { startIsolatedDb } from "./helpers/isolated-db";

// PR5 (ops console improvements) — "why this value" as a full
// waterfall, not only the winning source. Testcontainers only, per
// the standing instruction for this PR series.

const KEY = "attendance.absence_alert_threshold_pct"; // seeded by migrations, no seed-platform.ts needed

let isolated: IsolatedDb;
let resolveConfigChain: typeof import("@/db/config").resolveConfigChain;
let appPool: typeof import("@/db/client").pool;

beforeAll(async () => {
  isolated = await startIsolatedDb();
  process.env.DATABASE_URL = isolated.appUri;
  process.env.MIGRATION_DATABASE_URL = isolated.adminUri;
  process.env.APP_LOGIN_PASSWORD = decodeURIComponent(
    new URL(isolated.appUri).password,
  );
  vi.resetModules();
  ({ resolveConfigChain } = await import("@/db/config"));
  appPool = (await import("@/db/client")).pool;
}, 180_000);

afterAll(async () => {
  await appPool?.end();
  await isolated?.stop();
});

async function insertConfigValue(
  admin: IsolatedDb["admin"],
  args: { scopeType: string; scopeId: string | null; tenantId: string | null; value: number },
): Promise<void> {
  await admin.query(
    `insert into config_values (id, key, scope_type, scope_id, tenant_id, value)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [uuidv7(), KEY, args.scopeType, args.scopeId, args.tenantId, JSON.stringify(args.value)],
  );
}

describe("resolveConfigChain", () => {
  it("shows the code default as the winner when nothing overrides it", async () => {
    const admin = isolated.admin;
    const tenantId = uuidv7();
    await admin.query(
      `insert into tenants (id, slug, name, timezone, currency, created_at) values ($1, $2, 'No Overrides', 'Asia/Kolkata', 'INR', now())`,
      [tenantId, `chain-none-${uuidv7().slice(-8)}`],
    );

    const chain = await resolveConfigChain(tenantId as never, KEY as never);
    expect(chain.map((c) => c.scopeType)).toEqual([
      "platform",
      "plan",
      "preset",
      "tenant",
      "location",
      "activity",
    ]);
    const platform = chain.find((c) => c.scopeType === "platform")!;
    expect(platform.hasOverride).toBe(false);
    expect(platform.value).toBe(50); // config_keys.default_value
    expect(platform.isWinner).toBe(true);
    for (const level of chain.filter((c) => c.scopeType !== "platform")) {
      expect(level.isWinner).toBe(false);
      expect(level.hasOverride).toBe(false);
    }
  });

  it("shows overrides at two levels, with the more specific one winning", async () => {
    const admin = isolated.admin;
    const tenantId = uuidv7();
    await admin.query(
      `insert into tenants (id, slug, name, timezone, currency, created_at) values ($1, $2, 'Two Overrides', 'Asia/Kolkata', 'INR', now())`,
      [tenantId, `chain-two-${uuidv7().slice(-8)}`],
    );
    // Platform-wide override (tenant_id null) and a tenant-scoped one —
    // tenant must win over platform per the fixed resolution order.
    await insertConfigValue(admin, {
      scopeType: "platform",
      scopeId: null,
      tenantId: null,
      value: 60,
    });
    await insertConfigValue(admin, {
      scopeType: "tenant",
      scopeId: tenantId,
      tenantId,
      value: 80,
    });

    const chain = await resolveConfigChain(tenantId as never, KEY as never);
    const platform = chain.find((c) => c.scopeType === "platform")!;
    const tenant = chain.find((c) => c.scopeType === "tenant")!;
    expect(platform.hasOverride).toBe(true);
    expect(platform.value).toBe(60);
    expect(platform.isWinner).toBe(false);
    expect(tenant.hasOverride).toBe(true);
    expect(tenant.value).toBe(80);
    expect(tenant.isWinner).toBe(true);
    // Levels with no row report undefined, not a fabricated value.
    const preset = chain.find((c) => c.scopeType === "preset")!;
    expect(preset.hasOverride).toBe(false);
    expect(preset.value).toBeUndefined();
  });
});
