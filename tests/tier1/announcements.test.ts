import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { announcements, notifications } from "@/db/schema/announcements";
import { asMemberId, asTenantId, asUserId, type TenantId } from "@/lib/ids";

// U-06 — announcements and the in-app fan-out. Tenant/location/user/
// person/member/guardianship/membership/batch/enrolment fixtures go
// through the privileged migration pool (those tables are FORCE RLS);
// sends, reads and read-state updates go through the service over
// withTenant().

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const locA = uuidv7();
const locB = uuidv7();

const staffA = asUserId(uuidv7()); // active membership in A
const memberUser = asUserId(uuidv7()); // linked to the member's person
const guardianUser = asUserId(uuidv7()); // linked to the guardian's person
const staffB = asUserId(uuidv7()); // active membership in B only

const memberPerson = uuidv7();
const guardianPerson = uuidv7();
const memberA = asMemberId(uuidv7());
const roleA = uuidv7();
const roleB = uuidv7();
const programA = uuidv7();
const programB = uuidv7();
const batchA = uuidv7();
const batchB = uuidv7();

const ctxA = { tenantId: tenantA, userId: staffA, requestId: uuidv7() };
const ctxB = { tenantId: tenantB, userId: staffB };

let svc: typeof import("@/lib/services/announcements");

async function sendCount(tenantId: TenantId, action: string): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from audit_log where tenant_id = $1 and action = $2",
    [tenantId, action],
  );
  return Number(rows[0]?.count ?? "0");
}

beforeAll(async () => {
  svc = await import("@/lib/services/announcements");

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $2, 'Announce A', 'active', 'Asia/Kolkata'),
       ($3, $4, 'Announce B', 'active', 'Asia/Kolkata')`,
    [tenantA, `u06-a-${RUN}`, tenantB, `u06-b-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Ann A', true), ($2, $4, 'Ann B', true)`,
    [locA, locB, tenantA, tenantB],
  );
  await admin.query(
    `insert into users (id, phone, person_id) values
       ($1, $5, null), ($2, $6, null), ($3, $7, $8), ($4, $9, $10)`,
    [
      staffA,
      staffB,
      memberUser,
      guardianUser,
      `+9192${String(Date.now()).slice(-8)}1`,
      `+9192${String(Date.now()).slice(-8)}2`,
      `+9192${String(Date.now()).slice(-8)}3`,
      memberPerson,
      `+9192${String(Date.now()).slice(-8)}4`,
      guardianPerson,
    ],
  );
  await admin.query(
    `insert into persons (id, tenant_id, full_name, date_of_birth) values
       ($1, $2, 'Ananya Minor', '2015-06-11'),
       ($3, $2, 'Rohit Kapoor', '1986-02-20')`,
    [memberPerson, tenantA, guardianPerson],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, member_code, status, joined_on)
       values ($1, $2, $3, $4, 'ANN-001', 'active', '2026-01-01')`,
    [memberA, tenantA, memberPerson, locA],
  );
  await admin.query(
    `insert into guardianships (id, tenant_id, minor_id, guardian_id, relationship, is_primary)
       values ($1, $2, $3, $4, 'father', true)`,
    [uuidv7(), tenantA, memberPerson, guardianPerson],
  );
  await admin.query(
    `insert into roles (id, tenant_id, key, name, home_path, home_ordinal) values
       ($1, $3, 'owner', 'Owner', '/owner', 1),
       ($2, $4, 'owner', 'Owner', '/owner', 1)`,
    [roleA, roleB, tenantA, tenantB],
  );
  await admin.query(
    `insert into tenant_memberships (id, tenant_id, user_id, role_id, status) values
       ($1, $2, $3, $4, 'active'),
       ($5, $6, $7, $8, 'active')`,
    [uuidv7(), tenantA, staffA, roleA, uuidv7(), tenantB, staffB, roleB],
  );
  await admin.query(
    `insert into programs (id, tenant_id, name) values
       ($1, $2, 'Swim Juniors'), ($3, $4, 'Swim B')`,
    [programA, tenantA, programB, tenantB],
  );
  await admin.query(
    `insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time, location_id)
       values ($1, $2, $3, 'Junior 7am', 16, '{1,3,5}', '07:00', '08:00', $4),
              ($5, $6, $7, 'B batch', 10, '{2}', '18:00', '19:00', $8)`,
    [batchA, tenantA, programA, locA, batchB, tenantB, programB, locB],
  );
  await admin.query(
    `insert into enrolments (id, tenant_id, member_id, batch_id) values ($1, $2, $3, $4)`,
    [uuidv7(), tenantA, memberA, batchA],
  );
}, 60_000);

afterAll(async () => {
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("U-06 announcements and in-app notifications", () => {
  it("fans out `all` to memberships + member accounts + guardian accounts", async () => {
    const sent = await svc.sendAnnouncement(ctxA, {
      title: "Pool closed Saturday",
      body: "Maintenance — the 7am batch moves to Sunday.",
      audience: "all",
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.recipientCount).toBe(3);

    const mine = await svc.listMyNotifications(ctxA);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.title).toBe("Pool closed Saturday");
  });

  it("fans out `batch` to the enrolled member and their guardians", async () => {
    const sent = await svc.sendAnnouncement(ctxA, {
      title: "Junior 7am kit check",
      body: "Bring fins and a cap tomorrow.",
      audience: "batch",
      batchId: batchA,
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.recipientCount).toBe(2);
  });

  it("fans out `parents` to guardian accounts only", async () => {
    const sent = await svc.sendAnnouncement(ctxA, {
      title: "Fee reminder",
      body: "Term fees are due on the 30th.",
      audience: "parents",
    });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.recipientCount).toBe(1);
  });

  it("writes one audit row per send, carrying the recipient count", async () => {
    expect(await sendCount(tenantA, "announcement.send")).toBe(3);
    const { rows } = await admin.query<{ after: Record<string, unknown>; request_id: string }>(
      `select after, request_id from audit_log
        where tenant_id = $1 and action = 'announcement.send'
        order by created_at limit 1`,
      [tenantA],
    );
    expect(rows[0]?.after).toMatchObject({ audience: "all", recipientCount: 3, channel: "in_app" });
    expect(rows[0]?.request_id).toBe(ctxA.requestId);
  });

  it("updates read state only for the recipient", async () => {
    const mine = await svc.listMyNotifications(ctxA);
    const target = mine[0]!;
    const marked = await svc.markNotificationRead(ctxA, target.id);
    expect(marked.ok).toBe(true);

    const after = await svc.listMyNotifications(ctxA);
    expect(after.find((n) => n.id === target.id)?.readAt).not.toBeNull();

    // A different user in the same tenant cannot mark it read.
    const otherInTenant = { tenantId: tenantA, userId: memberUser };
    const denied = await svc.markNotificationRead(otherInTenant, target.id);
    expect(denied.ok).toBe(false);
    expect(await sendCount(tenantA, "notification.read")).toBe(1);
  });

  it("RLS: tenant B sees none of tenant A's announcements or notifications", async () => {
    const listed = await svc.listAnnouncements(ctxB);
    expect(listed).toEqual([]);

    const inbox = await svc.listMyNotifications(ctxB);
    expect(inbox).toEqual([]);

    const direct = await withTenant(tenantB, async (tx) => ({
      announcements: await tx.select({ id: announcements.id }).from(announcements),
      notifications: await tx.select({ id: notifications.id }).from(notifications),
    }));
    expect(direct.announcements).toEqual([]);
    expect(direct.notifications).toEqual([]);
  });

  it("refuses a batch from another tenant", async () => {
    const sent = await svc.sendAnnouncement(ctxA, {
      title: "Cross tenant",
      body: "Should not send.",
      audience: "batch",
      batchId: batchB,
    });
    expect(sent.ok).toBe(false);
    if (!sent.ok) expect(sent.error).toMatch(/not found/i);
  });

  it("refuses a batch audience without a batch id", async () => {
    const sent = await svc.sendAnnouncement(ctxA, {
      title: "No batch",
      body: "Should not send.",
      audience: "batch",
    });
    expect(sent.ok).toBe(false);
  });

  it("keeps announcements append-only and notifications undeletable for the app role", async () => {
    // The blanket deploy-time GRANT in db/bootstrap-roles.ts covers
    // every table; announcements/notifications are re-revoked there so
    // the guarantee survives re-bootstraps (the E-05 pattern).
    const { rows } = await admin.query<{
      announce_update: boolean;
      announce_delete: boolean;
      notif_delete: boolean;
      notif_update: boolean;
    }>(
      `select has_table_privilege('app_user', 'public.announcements', 'UPDATE') as announce_update,
              has_table_privilege('app_user', 'public.announcements', 'DELETE') as announce_delete,
              has_table_privilege('app_user', 'public.notifications', 'DELETE') as notif_delete,
              has_table_privilege('app_user', 'public.notifications', 'UPDATE') as notif_update`,
    );
    expect(rows[0]).toEqual({
      announce_update: false,
      announce_delete: false,
      notif_delete: false,
      notif_update: true,
    });
  });

  it("exposes recipient counts on the sent list", async () => {
    const listed = await svc.listAnnouncements(ctxA);
    expect(listed).toHaveLength(3);
    const all = listed.find((a) => a.audience === "all");
    expect(all?.recipientCount).toBe(3);
  });
});
