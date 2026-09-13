import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asUserId } from "@/lib/ids";

// O-10 (docs/ops-platform-design.md §7) — a lead converts into a
// working tenant whose preset and location count came from the
// qualification answers, with no re-entry.

let container: StartedPostgreSqlContainer;
let admin: Pool;
let convertLead: typeof import("@/db/platform-lead-conversion")["convertLead"];
let presetForQualification: typeof import("@/db/platform-lead-conversion")["presetForQualification"];
let leads: typeof import("@/db/platform-leads");

const actorId = asUserId(uuidv7());
const RUN = Date.now().toString(36);

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const adminUri = container.getConnectionUri();
  const appPassword = "isolated-test-pw";

  process.env.DATABASE_URL = `postgresql://app_login:${encodeURIComponent(appPassword)}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = appPassword;

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(adminUri, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(adminUri);
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(adminUri);

  const conversion = await import("@/db/platform-lead-conversion");
  convertLead = conversion.convertLead;
  presetForQualification = conversion.presetForQualification;
  leads = await import("@/db/platform-leads");

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, 'O-10 Operator', 'h', 's', 'admin', 'active')`,
    [actorId, `o10-${RUN}@platform.test`],
  );
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("lead → tenant conversion", () => {
  it("maps the sport answer onto a preset", () => {
    expect(presetForQualification({ sport: "swimming" })).toBe("swimming");
    expect(presetForQualification({ sport: "Tennis" })).toBe("multi-sport");
    expect(presetForQualification({ sport: "gymnastics" })).toBe(
      "start-from-scratch",
    );
    expect(presetForQualification({})).toBe("start-from-scratch");
  });

  it("provisions a tenant with the preset and location count from the answers", async () => {
    const created = await leads.createLead(
      {
        businessName: "Mehta Ventures",
        contactName: "Rohan Mehta",
        phone: `+9198${String(Date.now()).slice(-8)}`,
        city: "Pune",
        source: "referral",
        qualification: {
          sport: "swimming",
          memberCountBand: "50-150",
          locations: 2,
          gstRegistered: true,
        },
      },
      { actorId },
    );
    expect(created.kind).toBe("ok");
    if (created.kind !== "ok") return;

    const result = await convertLead(
      created.leadId,
      { slug: `mehta-${RUN}`, locationName: "Kothrud" },
      { actorId },
    );
    expect(result).toMatchObject({
      kind: "ok",
      preset: "swimming",
      presetApplied: true,
      locationsCreated: 2,
    });
    if (result.kind !== "ok") return;

    // The lead moved to trial with the tenant recorded.
    const lead = await leads.getLead(created.leadId);
    expect(lead?.status).toBe("trial");
    expect(lead?.trialTenantId).toBe(result.tenantId);

    // The tenant exists with two locations, one primary.
    const tenant = await admin.query<{ slug: string }>(
      "select slug from tenants where id = $1",
      [result.tenantId],
    );
    expect(tenant.rows[0].slug).toBe(`mehta-${RUN}`);

    const locationRows = await admin.query<{
      name: string;
      is_primary: boolean;
    }>(
      "select name, is_primary from locations where tenant_id = $1 order by name",
      [result.tenantId],
    );
    expect(locationRows.rows).toHaveLength(2);
    expect(locationRows.rows.filter((r) => r.is_primary)).toHaveLength(1);

    // The preset binding landed on the primary location.
    const binding = await admin.query<{ preset_key: string }>(
      `select lp.preset_key
         from location_presets lp
         join locations l on l.id = lp.location_id
        where l.tenant_id = $1 and l.is_primary`,
      [result.tenantId],
    );
    expect(binding.rows).toEqual([{ preset_key: "swimming" }]);

    // The conversion is audited on the lead and the extra locations.
    const audit = await admin.query<{ action: string; n: string }>(
      `select action, count(*)::text as n
         from platform_audit_log
        where tenant_id = $1
        group by action order by action`,
      [result.tenantId],
    );
    expect(audit.rows.map((r) => r.action)).toContain("tenant.create");
    expect(audit.rows.map((r) => r.action)).toContain("platform_lead.convert");
    expect(audit.rows.map((r) => r.action)).toContain("tenant.preset.apply");

    // A second conversion is refused: the lead already has a tenant.
    const again = await convertLead(
      created.leadId,
      { slug: `mehta-again-${RUN}` },
      { actorId },
    );
    expect(again.kind).toBe("error");
    if (again.kind === "error") expect(again.code).toBe("already_converted");
  });
});
