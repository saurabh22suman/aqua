import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId } from "@/lib/ids";

// O-09 (docs/ops-platform-design.md §7) — platform_leads lifecycle,
// guards and audit trail against a real database.

type LeadsModule = typeof import("@/db/platform-leads");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let leads: LeadsModule;

const actorId = asUserId(uuidv7());
const trialTenantId = asTenantId(uuidv7());
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
  leads = await import("@/db/platform-leads");

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, 'O-09 Operator', 'h', 's', 'admin', 'active')`,
    [actorId, `o09-${RUN}@platform.test`],
  );
  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, 'O-09 Trial', 'trial')",
    [trialTenantId, `o09-trial-${RUN}`],
  );
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("platform leads", () => {
  it("creates a lead with structured qualification answers and audits it", async () => {
    const result = await leads.createLead(
      {
        businessName: "Sharma Sports",
        contactName: "Priya Sharma",
        phone: "+919800000001",
        city: "Mumbai",
        source: "whatsapp",
        qualification: {
          sport: "swimming",
          memberCountBand: "50-150",
          feeModel: "monthly",
          collectionMode: "upi",
          gstRegistered: false,
          coachCount: 4,
          locations: 1,
        },
      },
      { actorId },
    );
    expect(result.kind).toBe("ok");

    const all = await leads.listLeads();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      businessName: "Sharma Sports",
      status: "lead",
      source: "whatsapp",
    });
    expect(all[0].qualification).toMatchObject({
      sport: "swimming",
      memberCountBand: "50-150",
    });

    const audit = await admin.query<{ action: string; detail: unknown }>(
      "select action, detail from platform_audit_log where target_id = $1",
      [all[0].id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["platform_lead.create"]);
  });

  it("requires a reason to mark a lead lost", async () => {
    const all = await leads.listLeads();
    const id = all[0].id;

    const withoutReason = await leads.transitionLead(
      id,
      { status: "lost" },
      { actorId },
    );
    expect(withoutReason.kind).toBe("error");

    const withReason = await leads.transitionLead(
      id,
      { status: "lost", lostReason: "Chose a cheaper competitor" },
      { actorId },
    );
    expect(withReason.kind).toBe("ok");

    const lead = await leads.getLead(id);
    expect(lead?.status).toBe("lost");
    expect(lead?.lostReason).toBe("Chose a cheaper competitor");
  });

  it("requires the trial tenant when moving a lead into trial", async () => {
    const all = await leads.listLeads();
    const id = all[0].id;

    const missing = await leads.transitionLead(
      id,
      { status: "trial" },
      { actorId },
    );
    expect(missing.kind).toBe("error");

    const ok = await leads.transitionLead(
      id,
      {
        status: "trial",
        trialTenantId,
        trialStartsAt: "2026-09-14T00:00:00.000Z",
        trialExpiresAt: "2026-09-28T00:00:00.000Z",
      },
      { actorId },
    );
    expect(ok.kind).toBe("ok");
    const lead = await leads.getLead(id);
    expect(lead?.trialTenantId).toBe(trialTenantId);
  });

  it("marks conversion with the tenant and keeps the audit trail in order", async () => {
    const all = await leads.listLeads();
    const id = all[0].id;

    const converted = await leads.markLeadConverted(id, trialTenantId, {
      actorId,
    });
    expect(converted.kind).toBe("ok");

    const lead = await leads.getLead(id);
    expect(lead?.status).toBe("converted");
    expect(lead?.convertedTenantId).toBe(trialTenantId);
    expect(lead?.convertedAt).toBeInstanceOf(Date);

    const audit = await admin.query<{ action: string }>(
      `select action from platform_audit_log
        where target_id = $1 order by created_at`,
      [id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "platform_lead.create",
      "platform_lead.update",
      "platform_lead.update",
      "platform_lead.update",
    ]);
  });

  it("finds a lead by phone (duplicate-intake guard)", async () => {
    const found = await leads.findLeadByPhone("+919800000001");
    expect(found?.businessName).toBe("Sharma Sports");
    expect(await leads.findLeadByPhone("+919800000099")).toBeNull();
  });
});
