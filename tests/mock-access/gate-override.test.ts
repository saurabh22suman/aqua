import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asTenantId, asUserId } from "@/lib/ids";
import { startGateFixture, type GateFixture } from "./fixture";

// Mock-only gate access — the manual override.
//
// A member is standing at the gate and the policy says no. An
// authorised staff member can let them in, but never silently: the
// override carries a written reason, it is attributed, and it lands in
// the access log AND the audit trail in one transaction.

let fx: GateFixture;

beforeAll(async () => {
  fx = await startGateFixture();
}, 180_000);

afterAll(async () => {
  await fx?.stop();
});

function owner(userId = fx.ids.staffUserId) {
  return {
    tenantId: asTenantId(fx.ids.tenantId),
    userId: asUserId(userId),
    permissions: new Set(["settings.manage"]),
  };
}

function receptionist() {
  return {
    tenantId: asTenantId(fx.ids.tenantId),
    userId: asUserId(fx.ids.staffUserId),
    permissions: new Set(["members.read", "bookings.write"]),
  };
}

describe("mock access — the manual override", () => {
  it("lets an authorised staff member in, with a written reason", async () => {
    const result = await fx.services.override.overrideGateAccess(owner(), {
      deviceKey: "main",
      memberId: fx.ids.memberNothing,
      reason: "Paying the outstanding dues at the desk",
    });
    expect(result.ok).toBe(true);

    const rows = await fx.admin.query<{
      decision: string;
      reason_code: string;
      override_reason: string;
      decided_by: string;
      member_id: string;
    }>(
      `select decision, reason_code, override_reason, decided_by, member_id
         from gate_access_events
        where tenant_id = $1 and reason_code = 'granted_manual_override'`,
      [fx.ids.tenantId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.decision).toBe("granted");
    expect(rows.rows[0]!.override_reason).toBe(
      "Paying the outstanding dues at the desk",
    );
    expect(rows.rows[0]!.decided_by).toBe(fx.ids.staffUserId);
    expect(rows.rows[0]!.member_id).toBe(fx.ids.memberNothing);
  });

  it("writes the audit row for the same access event", async () => {
    const result = await fx.services.override.overrideGateAccess(owner(), {
      deviceKey: "main",
      memberId: fx.ids.memberNothing,
      reason: "Duplicate card, verified at the desk",
      clientEventId: "override-audit-1",
    });
    expect(result.ok).toBe(true);

    const rows = await fx.admin.query<{
      action: string;
      entity_id: string;
      actor_id: string;
      after: Record<string, unknown>;
    }>(
      `select action, entity_id, actor_id, after
         from audit_log
        where tenant_id = $1 and action = 'gate.access.override'
        order by id desc
        limit 1`,
      [fx.ids.tenantId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.entity_id).toBe(
      result.ok ? result.eventId : "",
    );
    expect(rows.rows[0]!.actor_id).toBe(fx.ids.staffUserId);
    expect(rows.rows[0]!.after).toMatchObject({
      reason: "Duplicate card, verified at the desk",
    });
  });

  it("refuses a staff member without the management grant", async () => {
    const before = await fx.admin.query<{ n: number }>(
      "select count(*)::int as n from gate_access_events where tenant_id = $1",
      [fx.ids.tenantId],
    );
    const result = await fx.services.override.overrideGateAccess(receptionist(), {
      deviceKey: "main",
      memberId: fx.ids.memberNothing,
      reason: "Letting a friend in",
    });
    expect(result.ok).toBe(false);

    const after = await fx.admin.query<{ n: number }>(
      "select count(*)::int as n from gate_access_events where tenant_id = $1",
      [fx.ids.tenantId],
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it("refuses an override without a reason", async () => {
    const result = await fx.services.override.overrideGateAccess(owner(), {
      deviceKey: "main",
      memberId: fx.ids.memberNothing,
      reason: "",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses an override for somebody who is not a member here", async () => {
    const result = await fx.services.override.overrideGateAccess(owner(), {
      deviceKey: "main",
      memberId: fx.ids.staffUserId,
      reason: "Testing the boundary",
    });
    expect(result).toEqual({ ok: false, error: "Member not found." });
  });

  it("refuses an override at a gate this academy does not have", async () => {
    const result = await fx.services.override.overrideGateAccess(owner(), {
      deviceKey: "not-a-gate",
      memberId: fx.ids.memberNothing,
      reason: "Testing the boundary",
    });
    expect(result).toEqual({ ok: false, error: "Gate not found." });
  });

  it("writes nothing at all when the audit row cannot be written", async () => {
    // An actor id that is not a real user makes the audit row's
    // foreign key fail. The access event and the audit row are one
    // transaction, so neither survives.
    const stranger = "11111111-2222-4333-8444-555555555555";
    await expect(
      fx.services.override.overrideGateAccess(owner(stranger), {
        deviceKey: "main",
        memberId: fx.ids.memberNothing,
        reason: "Atomicity probe",
        clientEventId: "override-atomic-1",
      }),
    ).rejects.toThrow(/audit_log|foreign key|violates/i);

    const rows = await fx.admin.query<{ n: number }>(
      `select count(*)::int as n from gate_access_events
        where tenant_id = $1 and client_event_id = 'override-atomic-1'`,
      [fx.ids.tenantId],
    );
    expect(rows.rows[0]!.n).toBe(0);
  });
});
