import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { locations, members, memberStatusTransitions } from "@/db/schema";
import { createMember } from "@/lib/services/register";
import {
  pauseMember,
  resumeMember,
  transitionMemberStatus,
} from "@/lib/services/member-status";
import { asTenantId, type TenantId, type MemberId } from "@/lib/ids";

// Non-Tier-1 safety net -- same shape as consent-schema.test.ts. C-03/
// C-08's own done-when: "codes are unique per tenant and never reused"
// (C-03) and "each transition is audited and reversible" (C-08).

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";

let tenantId: TenantId = asTenantId("");
let locationId = "";

beforeAll(async () => {
  tenantId = asTenantId(uuidv7());
  const plan = await admin.query<{ id: string }>(
    "select id from plans where is_default = true",
  );
  await admin.query(
    "insert into tenants (id, slug, name, plan_id, timezone) values ($1, $2, 'Member Status', $3, $4)",
    [tenantId, `member-status-${RUN}`, plan.rows[0]?.id ?? null, TZ],
  );
  await withTenant(tenantId, async (tx) => {
    const [loc] = await tx
      .insert(locations)
      .values({ tenantId, name: "Status Hall", isPrimary: true })
      .returning({ id: locations.id });
    locationId = loc.id;
  });
});

afterAll(async () => {
  if (tenantId) {
    await admin.query("delete from member_status_transitions where tenant_id = $1", [tenantId]);
    await admin.query("delete from consents where tenant_id = $1", [tenantId]);
    await admin.query("delete from members where tenant_id = $1", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1", [tenantId]);
    await admin.query("delete from tenants where id = $1", [tenantId]);
  }
  await admin.end();
});

async function newMember(label: string) {
  const created = await createMember(
    { tenantId, userId: undefined },
    {
      fullName: `Status Subject ${label}`,
      dateOfBirth: "1990-01-01",
      locationId,
      memberCode: `STA-${RUN}-${label}`,
      consents: [
        { purpose: "processing", policyVersion: "2026.1", evidence: { channel: "staff-assisted-in-person" } },
      ],
    },
  );
  if (!created.ok) throw new Error("fixture setup failed: " + created.error);
  return created.memberId;
}

async function statusOf(memberId: MemberId): Promise<string> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx.select({ status: members.status }).from(members).where(eq(members.id, memberId)),
  );
  return row.status;
}

describe("transitionMemberStatus", () => {
  it("moves a member from active to paused with a reason, and records history", async () => {
    const memberId = await newMember("pause-history");
    const result = await transitionMemberStatus(
      { tenantId, userId: undefined },
      { memberId, toStatus: "paused", reason: "injury break" },
    );
    expect(result.ok).toBe(true);
    expect(await statusOf(memberId)).toBe("paused");

    const rows = await withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(memberStatusTransitions)
        .where(eq(memberStatusTransitions.memberId, memberId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].fromStatus).toBe("active");
    expect(rows[0].toStatus).toBe("paused");
    expect(rows[0].reason).toBe("injury break");
  });

  it("rejects a transition not in the allowed graph", async () => {
    const memberId = await newMember("bad-transition");
    // trial -> ... isn't reachable from active directly; going straight
    // to trial from active is not a real-world move and must be refused.
    const result = await transitionMemberStatus(
      { tenantId, userId: undefined },
      { memberId, toStatus: "trial", reason: "testing" },
    );
    expect(result.ok).toBe(false);
    expect(await statusOf(memberId)).toBe("active");
  });

  it("rejects a transition with no reason", async () => {
    const memberId = await newMember("no-reason");
    const result = await transitionMemberStatus(
      { tenantId, userId: undefined },
      { memberId, toStatus: "paused", reason: "" },
    );
    expect(result.ok).toBe(false);
  });

  it("is reversible: paused -> active -> paused both leave a trail", async () => {
    const memberId = await newMember("reversible");
    await transitionMemberStatus({ tenantId, userId: undefined }, { memberId, toStatus: "paused", reason: "a" });
    await transitionMemberStatus({ tenantId, userId: undefined }, { memberId, toStatus: "active", reason: "b" });
    await transitionMemberStatus({ tenantId, userId: undefined }, { memberId, toStatus: "paused", reason: "c" });

    expect(await statusOf(memberId)).toBe("paused");
    const rows = await withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(memberStatusTransitions)
        .where(eq(memberStatusTransitions.memberId, memberId))
        .orderBy(memberStatusTransitions.changedAt),
    );
    expect(rows.map((r) => r.toStatus)).toEqual(["paused", "active", "paused"]);
  });

  it("left is not a dead end -- can transition back to active", async () => {
    const memberId = await newMember("left-and-back");
    const left = await transitionMemberStatus(
      { tenantId, userId: undefined },
      { memberId, toStatus: "left", reason: "moved city" },
    );
    expect(left.ok).toBe(true);
    const rejoin = await transitionMemberStatus(
      { tenantId, userId: undefined },
      { memberId, toStatus: "active", reason: "moved back" },
    );
    expect(rejoin.ok).toBe(true);
    expect(await statusOf(memberId)).toBe("active");
  });
});

describe("pauseMember / resumeMember", () => {
  it("pauseMember pauses an active member and resumeMember resumes it", async () => {
    const memberId = await newMember("pause-resume");
    const paused = await pauseMember({ tenantId, userId: undefined }, memberId, "family trip");
    expect(paused.ok).toBe(true);
    expect(await statusOf(memberId)).toBe("paused");

    const resumed = await resumeMember({ tenantId, userId: undefined }, memberId, "back from trip");
    expect(resumed.ok).toBe(true);
    expect(await statusOf(memberId)).toBe("active");
  });

  it("resumeMember refuses a member that isn't paused", async () => {
    const memberId = await newMember("resume-not-paused");
    const result = await resumeMember({ tenantId, userId: undefined }, memberId, "why not");
    expect(result.ok).toBe(false);
    expect(await statusOf(memberId)).toBe("active");
  });
});

describe("members.status check constraint", () => {
  it("accepts every lifecycle value", async () => {
    for (const status of ["trial", "active", "paused", "lapsed", "left"]) {
      const memberId = await newMember(`ck-${status}`);
      await admin.query("update members set status = $1 where id = $2", [status, memberId]);
      // Read back — without this assertion, a future migration that
      // drops the check constraint without informing anyone (or a bug
      // in the UPDATE path) would let this test pass while the row
      // sat at its previous status. A green run with no read-back is
      // decoration, not a test (review-checklist §6).
      const got = await admin.query<{ status: string }>(
        "select status from members where id = $1",
        [memberId],
      );
      expect(got.rows[0]?.status).toBe(status);
    }
  });

  it("rejects a value outside the lifecycle, including the removed 'inactive'", async () => {
    const memberId = await newMember("ck-invalid");
    await expect(
      admin.query("update members set status = 'inactive' where id = $1", [memberId]),
    ).rejects.toThrow(/members_status_check/);
  });
});
