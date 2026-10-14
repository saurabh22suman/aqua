import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { asTenantId, asUserId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";

// Regression evidence for docs/audits/2026-10-09-role-content-permission-audit.md
// R03 (reception has tenant-wide announcement authority). The service
// must refuse academy-wide audiences ("all", "parents") for a sender
// without settings.manage, and refuse batch audiences whose location
// is outside the caller's location scope (a tenant-wide batch with no
// location counts as academy-wide). Owner/Admin (settings.manage)
// keep the current behaviour. Refusals must happen before any write,
// so no announcement, audit or outbox row is left behind.

type ReviewCtx = ActionCtx & { permissions: Set<string> };

let container: StartedPostgreSqlContainer;
let admin: Pool;
let announcements: typeof import("@/lib/services/announcements");

const RUN = Date.now().toString(36);
const tenantId = asTenantId(randomUUID());
const locA = randomUUID();
const locB = randomUUID();

const ownerUserId = asUserId(randomUUID());
const receptionUserId = asUserId(randomUUID());
const ownerRoleId = randomUUID();
const receptionRoleId = randomUUID();

const programId = randomUUID();
const batchA = randomUUID();
const batchB = randomUUID();
const batchTenantWide = randomUUID();

const restrictedReception: ReviewCtx = {
  tenantId,
  userId: receptionUserId,
  roleKey: "receptionist",
  allLocations: false,
  locationIds: [locA],
  permissions: new Set(["messaging.send"]),
};

const owner: ReviewCtx = {
  tenantId,
  userId: ownerUserId,
  roleKey: "owner",
  allLocations: true,
  locationIds: [],
  permissions: new Set(["messaging.send", "settings.manage"]),
};

async function counts(): Promise<{
  announcements: number;
  audit: number;
  outbox: number;
}> {
  const { rows } = await admin.query<{
    announcements: number;
    audit: number;
    outbox: number;
  }>(
    `select
       (select count(*)::int from announcements where tenant_id = $1::uuid) as announcements,
       (select count(*)::int from audit_log
          where tenant_id = $1::uuid and action = 'announcement.send') as audit,
       (select count(*)::int from whatsapp_notification_outbox
          where tenant_id = $1::uuid) as outbox`,
    [tenantId],
  );
  return rows[0]!;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const appPassword = "review-announcement-scope";
  process.env.DATABASE_URL = `postgresql://app_login:${appPassword}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = appPassword;
  const url = container.getConnectionUri();

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(url, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(url);

  announcements = await import("@/lib/services/announcements");

  admin = new Pool({ connectionString: url });
  await admin.query(
    "insert into tenants(id,slug,name,status,timezone) values($1,$2,'RA Scope','active','Asia/Kolkata')",
    [tenantId, `ra-scope-${RUN}`],
  );
  await admin.query(
    "insert into locations(id,tenant_id,name,is_primary) values($1,$3,'A site',true),($2,$3,'B site',false)",
    [locA, locB, tenantId],
  );
  await admin.query(
    "insert into users(id,phone) values($1,'+919820800301'),($2,'+919820800302')",
    [ownerUserId, receptionUserId],
  );
  await admin.query(
    `insert into roles(id,tenant_id,key,name,home_path,home_ordinal) values
       ($1,$3,'owner','Owner','/owner',0),
       ($2,$3,'receptionist','Receptionist','/reception',3)`,
    [ownerRoleId, receptionRoleId, tenantId],
  );
  const ownerMembership = randomUUID();
  const receptionMembership = randomUUID();
  await admin.query(
    `insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values
       ($1,$3,$4,$5,'active',true),
       ($2,$3,$6,$7,'active',false)`,
    [
      ownerMembership,
      receptionMembership,
      tenantId,
      ownerUserId,
      ownerRoleId,
      receptionUserId,
      receptionRoleId,
    ],
  );
  await admin.query(
    "insert into membership_locations(id,tenant_id,membership_id,location_id) values($1,$2,$3,$4)",
    [randomUUID(), tenantId, receptionMembership, locA],
  );
  await admin.query(
    "insert into programs(id,tenant_id,name) values($1,$2,'RA Program')",
    [programId, tenantId],
  );
  await admin.query(
    `insert into batches(id,tenant_id,program_id,location_id,name,capacity,start_time,end_time) values
       ($1,$2,$3,$4,'A batch',10,'07:00','08:00'),
       ($5,$2,$3,$6,'B batch',10,'07:00','08:00'),
       ($7,$2,$3,null,'Tenant-wide batch',10,'07:00','08:00')`,
    [batchA, tenantId, programId, locA, batchB, locB, batchTenantWide],
  );
  await admin.query(
    "insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true')",
    [randomUUID(), tenantId],
  );
}, 240_000);

afterAll(async () => {
  await (await import("@/db/client")).pool.end();
  await admin?.end();
  await container?.stop();
});

describe("review announcement sender scope (R03)", () => {
  it("refuses academy-wide audiences for a restricted receptionist, writing nothing", async () => {
    for (const audience of ["all", "parents"] as const) {
      const result = await announcements.sendAnnouncement(restrictedReception, {
        title: "Academy-wide",
        body: "Should be refused.",
        audience,
      });
      expect(result.ok).toBe(false);
    }
    expect(await counts()).toEqual({ announcements: 0, audit: 0, outbox: 0 });
  });

  it("refuses a batch at another location, writing nothing", async () => {
    const result = await announcements.sendAnnouncement(restrictedReception, {
      title: "Other site",
      body: "Should be refused.",
      audience: "batch",
      batchId: batchB,
    });
    expect(result.ok).toBe(false);
    expect(await counts()).toEqual({ announcements: 0, audit: 0, outbox: 0 });
  });

  it("refuses a tenant-wide batch (no location), writing nothing", async () => {
    const result = await announcements.sendAnnouncement(restrictedReception, {
      title: "Whole academy batch",
      body: "Should be refused.",
      audience: "batch",
      batchId: batchTenantWide,
    });
    expect(result.ok).toBe(false);
    expect(await counts()).toEqual({ announcements: 0, audit: 0, outbox: 0 });
  });

  it("positive: a restricted receptionist can send to a batch at an allowed location", async () => {
    const result = await announcements.sendAnnouncement(restrictedReception, {
      title: "A site update",
      body: "A site batch runs as usual.",
      audience: "batch",
      batchId: batchA,
    });
    expect(result.ok).toBe(true);
    const written = await counts();
    expect(written.announcements).toBe(1);
    expect(written.audit).toBe(1);
  });

  it("positive: an owner keeps academy-wide sends", async () => {
    const result = await announcements.sendAnnouncement(owner, {
      title: "Academy update",
      body: "The pool closes early on Friday.",
      audience: "all",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.recipientCount).toBe(2);

    const written = await counts();
    expect(written.announcements).toBe(2);
    expect(written.audit).toBe(2);
    expect(written.outbox).toBeGreaterThan(0);
  });
});
