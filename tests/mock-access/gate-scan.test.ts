import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId } from "@/lib/ids";
import { MockGateReader } from "@/lib/services/mock-access/reader";
import {
  GATE_NOW,
  expectedDigest,
  startGateFixture,
  type GateFixture,
} from "./fixture";

// Mock-only gate access — the scan.
//
// A gate event in, a decision out, one row in the access log. This
// file pins the behaviour a member and a staff member would argue
// about, plus the abuse cases: a replayed event, a replay carrying a
// different credential, another tenant's card, a cancelled card, a
// lapsed membership and a booking that has ended.

let fx: GateFixture;

beforeAll(async () => {
  fx = await startGateFixture();
}, 180_000);

afterAll(async () => {
  await fx?.stop();
});

function scan(
  overrides: Partial<{
    tenantId: string;
    deviceKey: string;
    method: "pin" | "rfid";
    secret: string;
    clientEventId: string;
    now: Date;
  }> = {},
) {
  return fx.services.gate.evaluateGateScan(
    {
      tenantId: asTenantId(overrides.tenantId ?? fx.ids.tenantId),
      deviceKey: overrides.deviceKey ?? "main",
      method: overrides.method ?? "rfid",
      secret: overrides.secret ?? "TAG-BOOKED-001",
      clientEventId:
        overrides.clientEventId ?? `evt-${Math.random().toString(36).slice(2)}`,
    },
    { now: overrides.now ?? GATE_NOW },
  );
}

async function eventCount(tenantId = fx.ids.tenantId): Promise<number> {
  const rows = await fx.admin.query<{ n: number }>(
    "select count(*)::int as n from gate_access_events where tenant_id = $1",
    [tenantId],
  );
  return rows.rows[0]!.n;
}

describe("mock access — the gate scan", () => {
  describe("decisions", () => {
    it("opens the premises gate for a member with a booking", async () => {
      const outcome = await scan({ method: "pin", secret: "482913" });
      expect(outcome.decision).toBe("granted");
      expect(outcome.reasonCode).toBe("granted_booking");
      expect(outcome.basis).toBe("booking");
      expect(outcome.memberId).toBe(fx.ids.memberBooked);
    });

    it("opens the court gate a member is booked on", async () => {
      const outcome = await scan({ deviceKey: "court1" });
      expect(outcome.decision).toBe("granted");
      expect(outcome.reasonCode).toBe("granted_booking");
    });

    it("does not open the other court to the same member", async () => {
      const outcome = await scan({ deviceKey: "court2" });
      expect(outcome.decision).toBe("denied");
      expect(outcome.reasonCode).toBe("denied_not_booked_here");
    });

    it("opens a court gate on a membership scoped to that court", async () => {
      const outcome = await scan({
        deviceKey: "court1",
        secret: "TAG-MEMBER-002",
      });
      expect(outcome.decision).toBe("granted");
      expect(outcome.reasonCode).toBe("granted_membership");
      expect(outcome.basis).toBe("membership");
    });

    it("denies a member with no booking and no membership, and says why", async () => {
      const outcome = await scan({
        deviceKey: "court1",
        secret: "TAG-NOTHING-003",
      });
      expect(outcome.decision).toBe("denied");
      expect(outcome.reasonCode).toBe("denied_no_membership");
    });

    it("denies a card it does not know", async () => {
      const outcome = await scan({
        deviceKey: "court1",
        secret: "TAG-NOT-ISSUED-999",
      });
      expect(outcome.decision).toBe("denied");
      expect(outcome.reasonCode).toBe("denied_unknown_credential");
      expect(outcome.memberId).toBeNull();
    });

    it("denies a blank presentation instead of failing", async () => {
      const outcome = await scan({ deviceKey: "court1", secret: "   " });
      expect(outcome.decision).toBe("denied");
      expect(outcome.reasonCode).toBe("denied_unknown_credential");
    });

    it("denies a card that was cancelled", async () => {
      const issued = await fx.services.credentials.issueGateCredential(
        {
          tenantId: asTenantId(fx.ids.tenantId),
          userId: asUserId(fx.ids.staffUserId),
          permissions: new Set(["settings.manage"]),
        },
        { memberId: fx.ids.memberBooked, kind: "rfid", secret: "TAG-CANCELLED-555" },
      );
      expect(issued.ok).toBe(true);
      await fx.services.credentials.revokeGateCredential(
        {
          tenantId: asTenantId(fx.ids.tenantId),
          userId: asUserId(fx.ids.staffUserId),
          permissions: new Set(["settings.manage"]),
        },
        { credentialId: issued.ok ? issued.credentialId : "" },
      );

      const outcome = await scan({
        deviceKey: "court1",
        secret: "TAG-CANCELLED-555",
      });
      expect(outcome.decision).toBe("denied");
      // The door must not tell a stranger that this tag once existed
      // here: a cancelled card and an unknown card answer alike.
      expect(outcome.reasonCode).toBe("denied_unknown_credential");
      expect(outcome.message).toBe(
        "We do not recognise that card or PIN.",
      );
      // And it must not carry the member the cancelled card belonged
      // to: the door says it does not recognise the tag.
      expect(outcome.memberId).toBeNull();

      // The staff log keeps the precise reason and the member.
      const rows = await fx.admin.query<{
        n: number;
        member_ids: string[] | null;
      }>(
        `select count(*)::int as n, array_agg(member_id) as member_ids
           from gate_access_events
          where tenant_id = $1 and reason_code = 'denied_credential_revoked'`,
        [fx.ids.tenantId],
      );
      expect(rows.rows[0]!.n).toBe(1);
      expect(rows.rows[0]!.member_ids).toEqual([fx.ids.memberBooked]);
    });

    it("opens a court for a booking of the whole facility", async () => {
      const owner = {
        tenantId: asTenantId(fx.ids.tenantId),
        userId: asUserId(fx.ids.staffUserId),
        permissions: new Set(["settings.manage"]),
      };
      const issued = await fx.services.credentials.issueGateCredential(owner, {
        memberId: fx.ids.memberNothing,
        kind: "rfid",
        secret: "TAG-FACILITY-BOOKED",
      });
      expect(issued.ok).toBe(true);
      await fx.admin.query(
        `insert into bookings
           (id, tenant_id, location_id, facility_id, member_id, starts_at, ends_at, status, price_paise)
         values ($1, $2, $3, $4, $5, '2026-10-26T09:00:00.000Z', '2026-10-26T11:00:00.000Z', 'confirmed', 0)`,
        [
          uuidv7(),
          fx.ids.tenantId,
          fx.ids.locationId,
          fx.ids.courtFacilityId,
          fx.ids.memberNothing,
        ],
      );

      const outcome = await scan({
        deviceKey: "court1",
        secret: "TAG-FACILITY-BOOKED",
      });
      expect(outcome.decision).toBe("granted");
      expect(outcome.reasonCode).toBe("granted_booking");

      // Leave the rest of the suite the academy it found.
      await fx.admin.query(
        "delete from bookings where member_id = $1 and sub_unit_id is null",
        [fx.ids.memberNothing],
      );
      await fx.admin.query(
        "delete from gate_credentials where member_id = $1 and kind = 'rfid' and secret_hash = $2",
        [
          fx.ids.memberNothing,
          expectedDigest(fx.ids.tenantId, "rfid", "TAG-FACILITY-BOOKED"),
        ],
      );
    });

    it("denies a member whose membership has lapsed", async () => {
      const outcome = await scan({
        deviceKey: "court1",
        secret: "TAG-LAPSED-004",
      });
      expect(outcome.reasonCode).toBe("denied_member_inactive");
      expect(outcome.message).toBe("This member's membership is not active.");
    });

    it("stops opening a gate whose court was retired", async () => {
      await fx.admin.query(
        "update facility_sub_units set deleted_at = now() where id = $1",
        [fx.ids.subUnitCourt1],
      );
      try {
        const outcome = await scan({ deviceKey: "court1" });
        expect(outcome.decision).toBe("denied");
        expect(outcome.reasonCode).toBe("denied_device_disabled");
      } finally {
        await fx.admin.query(
          "update facility_sub_units set deleted_at = null where id = $1",
          [fx.ids.subUnitCourt1],
        );
      }
    });

    it("denies a PIN at a gate that only reads RFID", async () => {
      const outcome = await scan({
        deviceKey: "court1",
        method: "pin",
        secret: "482913",
      });
      expect(outcome.reasonCode).toBe("denied_method_not_accepted");
    });

    it("denies a gate this academy does not have", async () => {
      const outcome = await scan({ deviceKey: "not-a-gate" });
      expect(outcome.decision).toBe("denied");
      expect(outcome.reasonCode).toBe("denied_unknown_device");
    });

    it("denies once the booking has ended", async () => {
      const outcome = await scan({
        deviceKey: "court1",
        now: new Date("2026-10-26T12:00:00.000Z"),
      });
      expect(outcome.reasonCode).toBe("denied_no_active_booking");
    });

    it("denies a membership that ran out", async () => {
      const outcome = await scan({
        deviceKey: "court1",
        secret: "TAG-MEMBER-002",
        now: new Date("2026-11-05T10:00:00.000Z"),
      });
      expect(outcome.reasonCode).toBe("denied_membership_expired");
    });
  });

  describe("the access log", () => {
    it("writes exactly one row per scan", async () => {
      const before = await eventCount();
      await scan({ clientEventId: "evt-log-1" });
      expect(await eventCount()).toBe(before + 1);
    });

    it("carries a staff-facing line for the reason", async () => {
      const outcome = await scan({ clientEventId: "evt-log-message" });
      expect(outcome.message).toBe(
        "Access granted — a booking covers this gate now.",
      );
      const denied = await scan({
        deviceKey: "court1",
        secret: "TAG-NOTHING-003",
        clientEventId: "evt-log-message-2",
      });
      expect(denied.message).toBe(
        "There is no membership or booking for this gate.",
      );
    });

    it("refuses a log row whose decision and reason disagree", async () => {
      const device = await fx.admin.query<{ id: string }>(
        "select id from gate_devices where tenant_id = $1 and device_key = 'main'",
        [fx.ids.tenantId],
      );
      await expect(
        fx.admin.query(
          `insert into gate_access_events
             (id, tenant_id, device_id, method, decision, reason_code, occurred_at, client_event_id, credential_fingerprint)
           values ($3, $1, $2, 'rfid', 'granted', 'denied_no_membership', now(), 'evt-contradiction', repeat('a', 64))`,
          [fx.ids.tenantId, device.rows[0]!.id, uuidv7()],
        ),
      ).rejects.toThrow(/gate_access_events_decision_reason_check/);
    });

    it("reads a credential from a gate reader", async () => {
      const reader = new MockGateReader([
        { kind: "rfid", value: "TAG-BOOKED-001" },
      ]);
      const reading = await reader.read();
      expect(reading).toEqual({ kind: "rfid", value: "TAG-BOOKED-001" });

      const outcome = await fx.services.gate.evaluateGateReading(
        {
          tenantId: asTenantId(fx.ids.tenantId),
          deviceKey: "court1",
          reading: reading ?? { kind: "rfid", value: "" },
          clientEventId: "evt-reader-1",
        },
        { now: GATE_NOW },
      );
      expect(outcome.decision).toBe("granted");
      expect(outcome.reasonCode).toBe("granted_booking");
    });

    it("never stores the presented secret", async () => {
      await scan({ clientEventId: "evt-log-2", secret: "TAG-SECRET-CHECK-321" });
      const rows = await fx.admin.query<Record<string, unknown>>(
        "select * from gate_access_events where tenant_id = $1",
        [fx.ids.tenantId],
      );
      expect(JSON.stringify(rows.rows)).not.toContain("TAG-SECRET-CHECK-321");
    });

    it("stores the credential digest, not the credential", async () => {
      await scan({ clientEventId: "evt-log-3" });
      const rows = await fx.admin.query<{ credential_fingerprint: string | null }>(
        "select credential_fingerprint from gate_access_events where tenant_id = $1 and client_event_id = 'evt-log-3'",
        [fx.ids.tenantId],
      );
      expect(rows.rows[0]!.credential_fingerprint).toBe(
        expectedDigest(fx.ids.tenantId, "rfid", "TAG-BOOKED-001"),
      );
    });
  });

  describe("replay", () => {
    it("refuses a replay whose entitlement has since run out", async () => {
      const first = await scan({ clientEventId: "evt-replay-expiry" });
      expect(first.decision).toBe("granted");

      // The same event, replayed two hours later, when the booking has
      // ended. A replay must not outlive the entitlement that opened
      // the gate.
      const later = await scan({
        clientEventId: "evt-replay-expiry",
        now: new Date("2026-10-26T12:00:00.000Z"),
      });
      expect(later.decision).toBe("denied");
      expect(later.reasonCode).toBe("denied_no_active_booking");
      expect(later.idempotentReplay).toBe(true);
    });

    it("returns the stored decision for a replayed event and logs nothing new", async () => {
      const first = await scan({ clientEventId: "evt-replay-1" });
      const before = await eventCount();
      const second = await scan({ clientEventId: "evt-replay-1" });

      expect(second.decision).toBe(first.decision);
      expect(second.reasonCode).toBe(first.reasonCode);
      expect(second.idempotentReplay).toBe(true);
      expect(second.eventId).toBe(first.eventId);
      expect(await eventCount()).toBe(before);
    });

    it("refuses a replay that carries a different credential", async () => {
      const first = await scan({ clientEventId: "evt-replay-2" });
      const before = await eventCount();
      const second = await scan({
        clientEventId: "evt-replay-2",
        secret: "TAG-MEMBER-002",
      });

      expect(second.decision).toBe("denied");
      expect(second.reasonCode).toBe("denied_event_conflict");
      expect(await eventCount()).toBe(before);

      const rows = await fx.admin.query<{
        decision: string;
        reason_code: string;
        member_id: string | null;
      }>(
        "select decision, reason_code, member_id from gate_access_events where tenant_id = $1 and client_event_id = 'evt-replay-2'",
        [fx.ids.tenantId],
      );
      expect(rows.rows[0]!.decision).toBe(first.decision);
      expect(rows.rows[0]!.reason_code).toBe(first.reasonCode);
      expect(rows.rows[0]!.member_id).toBe(fx.ids.memberBooked);
    });
  });

  describe("concurrent writers", () => {
    it("refuses an event id that another credential claimed while the scan was running", async () => {
      // The other writer holds an uncommitted row for this event id.
      // The scan cannot see it yet (read committed), so it proceeds —
      // and its insert then loses the race on the unique key. The
      // loser must not simply adopt the winner's decision.
      const device = await fx.admin.query<{ id: string }>(
        "select id from gate_devices where tenant_id = $1 and device_key = 'court1'",
        [fx.ids.tenantId],
      );
      const blocker = await fx.admin.connect();
      try {
        await blocker.query("begin");
        await blocker.query(
          `insert into gate_access_events
             (id, tenant_id, device_id, method, decision, reason_code, basis, occurred_at, client_event_id, credential_fingerprint)
           values ($1, $2, $3, 'rfid', 'granted', 'granted_membership', 'membership', $4, 'evt-race-blocked', $5)`,
          [
            uuidv7(),
            fx.ids.tenantId,
            device.rows[0]!.id,
            GATE_NOW,
            expectedDigest(fx.ids.tenantId, "rfid", "TAG-MEMBER-002"),
          ],
        );

        const pending = scan({
          deviceKey: "court1",
          clientEventId: "evt-race-blocked",
        });
        await new Promise((resolve) => setTimeout(resolve, 250));
        await blocker.query("commit");

        const outcome = await pending;
        expect(outcome.decision).toBe("denied");
        expect(outcome.reasonCode).toBe("denied_event_conflict");
      } finally {
        await blocker.query("rollback").catch(() => {});
        blocker.release();
      }
    });

    it("never lets one credential take over another one's event id", async () => {
      // One member with a live booking and a crowd of members with no
      // entitlement, all presenting the SAME client event id at the
      // same gate. Exactly one event may be recorded, and the event
      // must not hand a "granted" to a credential that has no
      // entitlement — whichever writer wins the insert.
      const entitled = fx.services.gate.evaluateGateScan(
        {
          tenantId: asTenantId(fx.ids.tenantId),
          deviceKey: "court1",
          method: "rfid",
          secret: "TAG-BOOKED-001",
          clientEventId: "evt-race-1",
        },
        { now: GATE_NOW },
      );
      const intruders = Array.from({ length: 11 }, () =>
        fx.services.gate.evaluateGateScan(
          {
            tenantId: asTenantId(fx.ids.tenantId),
            deviceKey: "court1",
            method: "rfid",
            secret: "TAG-NOTHING-003",
            clientEventId: "evt-race-1",
          },
          { now: GATE_NOW },
        ),
      );
      const outcomes = await Promise.all([entitled, ...intruders]);

      const rows = await fx.admin.query<{ n: number }>(
        `select count(*)::int as n from gate_access_events
          where tenant_id = $1 and client_event_id = 'evt-race-1'`,
        [fx.ids.tenantId],
      );
      expect(rows.rows[0]!.n).toBe(1);

      // No scan with an unentitled credential may come back granted.
      for (const outcome of outcomes.slice(1)) {
        expect(outcome.decision).not.toBe("granted");
      }
      // The entitled member either wins the event or is told the event
      // was already used with a different credential.
      expect(["granted", "denied_event_conflict"]).toContain(
        outcomes[0]!.decision,
      );
    });
  });

  describe("tenant isolation", () => {
    it("keeps one academy's card out of another academy's gate", async () => {
      const beforeHere = await eventCount(fx.ids.tenantId);

      // A tag only THIS academy issued is unknown to the other academy.
      const unknownThere = await scan({
        tenantId: fx.ids.otherTenantId,
        deviceKey: "main",
        secret: "TAG-NOTHING-003",
      });
      expect(unknownThere.decision).toBe("denied");
      expect(unknownThere.reasonCode).toBe("denied_unknown_credential");

      // The same raw tag, issued by the OTHER academy, resolves to that
      // academy's member — never to this academy's member.
      const there = await scan({
        tenantId: fx.ids.otherTenantId,
        deviceKey: "main",
        secret: "TAG-BOOKED-001",
      });
      expect(there.memberId).toBe(fx.ids.otherMemberId);
      expect(there.memberId).not.toBe(fx.ids.memberBooked);

      // Nothing crossed over into this academy's log.
      expect(await eventCount(fx.ids.tenantId)).toBe(beforeHere);
    });

    it("gives the same card a different digest in another academy", () => {
      expect(expectedDigest(fx.ids.tenantId, "rfid", "TAG-BOOKED-001")).not.toBe(
        expectedDigest(fx.ids.otherTenantId, "rfid", "TAG-BOOKED-001"),
      );
    });
  });
});
