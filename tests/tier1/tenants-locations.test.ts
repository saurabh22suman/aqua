import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";

// tenants and locations both have FORCE row level security, so fixture
// rows must be created through the privileged migration pool, never the
// app pool.
const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const SLUG_A = `f02-a-${RUN}`;
const SLUG_B = `f02-b-${RUN}`;
const PRESET_KEY = `f02-preset-${RUN}`;

const tenantIds: string[] = [];
const locationIds: string[] = [];

async function expectPgError(
  promise: Promise<unknown>,
): Promise<{ code?: string; constraint?: string }> {
  try {
    await promise;
    return {};
  } catch (err) {
    const e = err as { code?: string; constraint?: string };
    return { code: e.code, constraint: e.constraint };
  }
}

afterAll(async () => {
  for (const id of locationIds) {
    await admin.query("delete from locations where id = $1", [id]);
  }
  for (const id of tenantIds) {
    await admin.query("delete from tenants where id = $1", [id]);
  }
  await admin.query("delete from presets where key = $1", [PRESET_KEY]);
  await admin.end();
});

describe("F-02 tenants and locations", () => {
  it("two tenants and three locations insert cleanly — one primary per tenant", async () => {
    const a = uuidv7();
    const b = uuidv7();
    await admin.query(
      "insert into tenants (id, slug, name) values ($1, $2, 'F-02 A')",
      [a, SLUG_A],
    );
    await admin.query(
      "insert into tenants (id, slug, name) values ($1, $2, 'F-02 B')",
      [b, SLUG_B],
    );
    tenantIds.push(a, b);

    const locA1 = uuidv7();
    const locA2 = uuidv7();
    const locB1 = uuidv7();
    await admin.query(
      "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Head', true), ($3, $2, 'Annex', false), ($4, $5, 'Solo', true)",
      [locA1, a, locA2, locB1, b],
    );
    locationIds.push(locA1, locA2, locB1);

    const total = await admin.query<{ n: number }>(
      "select count(*)::int as n from locations where id = any($1)",
      [locationIds],
    );
    expect(total.rows[0].n).toBe(3);

    const primaries = await admin.query<{ tenant_id: string; n: number }>(
      "select tenant_id, count(*)::int as n from locations where id = any($1) and is_primary group by tenant_id",
      [locationIds],
    );
    expect(primaries.rows).toHaveLength(2);
    for (const row of primaries.rows) expect(row.n).toBe(1);
  });

  it("duplicate slug is rejected", async () => {
    const err = await expectPgError(
      admin.query(
        "insert into tenants (id, slug, name) values ($1, $2, 'Dup')",
        [uuidv7(), SLUG_A],
      ),
    );
    expect(err.code).toBe("23505");
    expect(err.constraint).toBe("tenants_slug_key");
  });

  it("new columns carry their documented defaults on a bare insert", async () => {
    const bare = uuidv7();
    await admin.query(
      "insert into tenants (id, slug, name) values ($1, $2, 'F-02 defaults')",
      [bare, `f02-def-${RUN}`],
    );
    tenantIds.push(bare);

    const row = await admin.query<{
      currency: string;
      gstin: string | null;
      branding: Record<string, unknown>;
      terminology: Record<string, unknown>;
      preset_key: string | null;
      preset_version: number | null;
      preset_applied_at: string | null;
    }>(
      "select currency, gstin, branding, terminology, preset_key, preset_version, preset_applied_at from tenants where id = $1",
      [bare],
    );
    const r = row.rows[0];
    expect(r.currency).toBe("INR");
    expect(r.gstin).toBeNull();
    expect(r.branding).toEqual({});
    expect(r.terminology).toEqual({});
    expect(r.preset_key).toBeNull();
    expect(r.preset_version).toBeNull();
    expect(r.preset_applied_at).toBeNull();
  });

  it("the preset pair is both-or-neither and must reference a real preset", async () => {
    const t = tenantIds[0];

    const halfErr = await expectPgError(
      admin.query("update tenants set preset_key = $1 where id = $2", [
        PRESET_KEY,
        t,
      ]),
    );
    expect(halfErr.code).toBe("23514");
    expect(halfErr.constraint).toBe("tenants_preset_pair_check");

    const missingErr = await expectPgError(
      admin.query(
        "update tenants set preset_key = $1, preset_version = $2 where id = $3",
        [PRESET_KEY, 999, t],
      ),
    );
    expect(missingErr.code).toBe("23503");
    expect(missingErr.constraint).toBe("tenants_preset_fkey");

    await admin.query(
      "insert into presets (key, version, name, description, definition) values ($1, 1, 'F-02 fixture', 'fixture for the F-02 test', '{}')",
      [PRESET_KEY],
    );
    await admin.query(
      "update tenants set preset_key = $1, preset_version = 1 where id = $2",
      [PRESET_KEY, t],
    );

    const row = await admin.query<{
      preset_key: string;
      preset_version: number;
    }>("select preset_key, preset_version from tenants where id = $1", [t]);
    expect(row.rows[0]).toEqual({
      preset_key: PRESET_KEY,
      preset_version: 1,
    });
  });

  it("locations.address accepts and round-trips a jsonb object", async () => {
    const loc = locationIds[0];
    const address = { line1: "12 Lake Road", city: "Kolkata", pin: "700001" };
    await admin.query("update locations set address = $1 where id = $2", [
      address,
      loc,
    ]);

    const row = await admin.query<{ address: Record<string, unknown> }>(
      "select address from locations where id = $1",
      [loc],
    );
    expect(row.rows[0].address).toEqual(address);
  });
});
