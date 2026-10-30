import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { deleteAuditRowsForTenant } from "../../helpers/audit-log-cleanup";
// The privileged pool is the SANCTIONED fixture helper
// (tests/db/privileged-fixture.ts): a privileged connection for FIXTURE
// SETUP only. Every assertion below runs against the application's own
// services, which connect as `app_login` under tenant RLS.
import { asTenantId, asUserId } from "@/lib/ids";
import { withTenant } from "@/db/tenant";
import { members, persons } from "@/db/schema/people";
import { enrolments } from "@/db/schema/scheduling";

// D-1 (independent review) — a real, permission-checked request must
// keep its actor and request attribution on the audit row.
//
// The four call sites below rebuilt a narrowed `{ tenantId, userId }`
// context before calling the service. That literal carries no roleKey
// and no permission set, so the service's actor rule classified a REAL
// request as a legacy/system caller and wrote `actor_type='system'`,
// `actor_id=NULL`, `request_id=NULL`. For the transfer path this was a
// regression: the base wrote the real actor id.
//
// This is a DIRECT ACTION regression: only the auth context is mocked
// (the action's `requireDefaultCtx`); `requirePermission` and the
// service run for real against the real database, so the assertion is
// on the audit row the user's action produced — not on an adapter's
// argument. It also keeps the negative grant: without the permission
// the action refuses and writes nothing.

const mocks = vi.hoisted(() => ({ ctx: vi.fn() }));

vi.mock("@/lib/auth/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/context")>();
  return { ...actual, requireDefaultCtx: mocks.ctx };
});

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

const tenant = asTenantId(uuidv7());
const locationId = uuidv7();
const programId = uuidv7();
const sourceBatchId = uuidv7();
const destBatchId = uuidv7();
const memberId = uuidv7();
const actor = asUserId(uuidv7());
const requestId = uuidv7();

const permissions = new Set([
  "settings.manage",
  "staff.write",
  "staff.read",
  "members.write",
  "members.read",
]);

const requestCtx = {
  tenantId: tenant,
  userId: actor,
  membershipId: uuidv7(),
  roleKey: "owner",
  roleId: uuidv7(),
  slug: "d-action-attribution",
  allLocations: true,
  locationIds: [] as string[],
  permissions,
  features: new Set(["staff", "settings", "members"]),
  requestId,
};

type AuditRow = {
  action: string;
  actor_type: string;
  actor_id: string | null;
  request_id: string | null;
};

async function auditRows(action: string): Promise<AuditRow[]> {
  const { rows } = await admin.query<AuditRow>(
    "select action, actor_type, actor_id, request_id from audit_log where tenant_id = $1 and action = $2 order by created_at",
    [tenant, action],
  );
  return rows;
}

async function countAudit(action: string): Promise<number> {
  return (await auditRows(action)).length;
}

beforeAll(async () => {
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9188${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Action Attribution', 'active', $3)",
    [tenant, `d-attr-${RUN}`, TZ],
  );
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Attr Hall', true)",
    [locationId, tenant],
  );
  await admin.query("insert into programs (id, tenant_id, name) values ($1, $2, 'Attr Program')", [
    programId,
    tenant,
  ]);
  await admin.query(
    `insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time, location_id)
     values ($1, $3, $4, 'From Batch', 10, '{1}', '07:00', '08:00', $5),
            ($2, $3, $4, 'To Batch', 10, '{2}', '09:00', '10:00', $5)`,
    [sourceBatchId, destBatchId, tenant, programId, locationId],
  );
  await withTenant(tenant, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ tenantId: tenant, fullName: `Attr Member ${RUN}`, dateOfBirth: "1990-01-01" })
      .returning({ id: persons.id });
    await tx.insert(members).values({
      id: memberId as never,
      tenantId: tenant,
      personId: person!.id,
      locationId,
      memberCode: `ATTR-${RUN}`,
      status: "active",
    });
    await tx.insert(enrolments).values({
      tenantId: tenant,
      memberId: memberId as never,
      batchId: sourceBatchId,
      enrolledOn: "2026-10-01",
    });
  });
}, 60_000);

afterAll(async () => {
  // D-F1 — the append-only audit rows and the fixture's actor leave with
  // the fixture, through the sanctioned test-only cleanup helper.
  await deleteAuditRowsForTenant(admin, tenant);
  await admin.query("delete from enrolments where tenant_id = $1", [tenant]);
  await admin.query("delete from staff where tenant_id = $1", [tenant]);
  await admin.query("delete from members where tenant_id = $1", [tenant]);
  await admin.query("delete from persons where tenant_id = $1", [tenant]);
  await admin.query("delete from tenant_holidays where tenant_id = $1", [tenant]);
  await admin.query("delete from batches where tenant_id = $1", [tenant]);
  await admin.query("delete from programs where tenant_id = $1", [tenant]);
  await admin.query("delete from locations where tenant_id = $1", [tenant]);
  await admin.query("delete from tenants where id = $1", [tenant]);
  await admin.query("delete from users where id = $1", [actor]);
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("D-1 the action boundary preserves the real actor and request", () => {
  it("attributes a holiday add and remove to the requesting user", async () => {
    mocks.ctx.mockResolvedValue(requestCtx);
    const holidays = await import("@/lib/actions/holidays");
    const created = await holidays.addHolidayAction({
      name: "Founders Day",
      holidayDate: "2026-11-14",
    });
    expect(created.kind).toBe("ok");
    if (created.kind !== "ok") return;

    const added = await auditRows("holiday.add");
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      actor_type: "user",
      actor_id: actor,
      request_id: requestId,
    });

    const removed = await holidays.removeHolidayAction({ holidayId: created.holidayId });
    expect(removed.kind).toBe("ok");
    const rows = await auditRows("holiday.remove");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_type: "user",
      actor_id: actor,
      request_id: requestId,
    });
  });

  it("attributes a staff creation to the requesting user", async () => {
    mocks.ctx.mockResolvedValue(requestCtx);
    const staffActions = await import("@/lib/actions/staff");
    const created = await staffActions.createStaffAction({
      fullName: `Attr Coach ${RUN}`,
      staffType: "coach",
    });
    expect(created.kind).toBe("ok");

    const rows = await auditRows("staff.create");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_type: "user",
      actor_id: actor,
      request_id: requestId,
    });
  });

  it("attributes a batch transfer to the requesting user (the base wrote the actor id)", async () => {
    mocks.ctx.mockResolvedValue(requestCtx);
    const transfer = await import("@/lib/actions/transfer");
    const result = await transfer.transferMemberToBatchAction({
      memberId,
      fromBatchId: sourceBatchId,
      toBatchId: destBatchId,
    });
    expect(result.kind).toBe("ok");

    const rows = await auditRows("member.transfer");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_type: "user",
      actor_id: actor,
      request_id: requestId,
    });
  });

  it("still refuses the action without its grant and writes nothing", async () => {
    mocks.ctx.mockResolvedValue({
      ...requestCtx,
      permissions: new Set(["members.read"]),
    });
    const holidays = await import("@/lib/actions/holidays");
    const before = await countAudit("holiday.add");

    await expect(
      holidays.addHolidayAction({ name: "Not Allowed", holidayDate: "2026-11-15" }),
    ).rejects.toThrow(/forbidden/i);

    expect(await countAudit("holiday.add")).toBe(before);
  });
});
