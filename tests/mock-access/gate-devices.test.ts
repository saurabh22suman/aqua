import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asTenantId, asUserId } from "@/lib/ids";
import { startGateFixture, type GateFixture } from "./fixture";

// Mock-only gate access — the management surface.
//
// The desk needs to see the gates an academy has and put new ones in,
// and a member's card list must never hand back a digest. These are
// the operations the owner performs; the scan path is separate.

let fx: GateFixture;

beforeAll(async () => {
  fx = await startGateFixture();
}, 180_000);

afterAll(async () => {
  await fx?.stop();
});

function owner(tenantId = fx.ids.tenantId) {
  return {
    tenantId: asTenantId(tenantId),
    userId: asUserId(fx.ids.staffUserId),
    permissions: new Set(["settings.manage"]),
  };
}

function receptionist() {
  return {
    tenantId: asTenantId(fx.ids.tenantId),
    userId: asUserId(fx.ids.staffUserId),
    permissions: new Set(["members.read"]),
  };
}

describe("mock access — the gate registry", () => {
  it("registers a premises gate that reads a PIN and an RFID tag", async () => {
    const result = await fx.services.devices.registerGateDevice(owner(), {
      deviceKey: "reception",
      label: "Reception Gate",
      locationId: fx.ids.locationId,
      acceptsPin: true,
      acceptsRfid: true,
    });
    expect(result.ok).toBe(true);
  });

  it("registers a court gate bound to one court of a facility", async () => {
    const result = await fx.services.devices.registerGateDevice(owner(), {
      deviceKey: "court3",
      label: "Court 3 Gate",
      locationId: fx.ids.locationId,
      facilityId: fx.ids.courtFacilityId,
      subUnitId: fx.ids.subUnitCourt1,
      acceptsRfid: true,
    });
    expect(result.ok).toBe(true);

    const devices = await fx.services.devices.listGateDevices(owner());
    const court3 = devices.find((d) => d.deviceKey === "court3");
    expect(court3).toMatchObject({
      facilityId: fx.ids.courtFacilityId,
      subUnitId: fx.ids.subUnitCourt1,
      acceptsRfid: true,
      acceptsPin: false,
      status: "active",
    });
  });

  it("refuses a gate that reads nothing at all", async () => {
    const result = await fx.services.devices.registerGateDevice(owner(), {
      deviceKey: "silent",
      label: "Silent Gate",
      locationId: fx.ids.locationId,
    });
    expect(result).toEqual({
      ok: false,
      error: "A gate must accept a PIN, an RFID tag, or both.",
    });
  });

  it("refuses a court gate that does not name its facility", async () => {
    const result = await fx.services.devices.registerGateDevice(owner(), {
      deviceKey: "orphan-court",
      label: "Orphan Court",
      locationId: fx.ids.locationId,
      subUnitId: fx.ids.subUnitCourt2,
      acceptsRfid: true,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a gate bound to a facility at another location", async () => {
    const result = await fx.services.devices.registerGateDevice(owner(), {
      deviceKey: "wrong-location",
      label: "Wrong Location",
      locationId: fx.ids.locationId,
      facilityId: fx.ids.poolFacilityId,
      acceptsRfid: true,
    });
    expect(result).toEqual({
      ok: false,
      error: "That facility is not at this location.",
    });
  });

  it("refuses a court that belongs to another facility", async () => {
    const result = await fx.services.devices.registerGateDevice(owner(), {
      deviceKey: "wrong-court",
      label: "Wrong Court",
      locationId: fx.ids.locationId,
      facilityId: fx.ids.courtFacilityId,
      subUnitId: fx.ids.staffUserId,
      acceptsRfid: true,
    });
    expect(result).toEqual({
      ok: false,
      error: "That court is not part of this facility.",
    });
  });

  it("refuses a second gate with the same key", async () => {
    const result = await fx.services.devices.registerGateDevice(owner(), {
      deviceKey: "main",
      label: "Another Main Gate",
      locationId: fx.ids.locationId,
      acceptsRfid: true,
    });
    expect(result).toEqual({
      ok: false,
      error: "This academy already has that gate.",
    });
  });

  it("refuses a location that belongs to another academy", async () => {
    const result = await fx.services.devices.registerGateDevice(owner(), {
      deviceKey: "elsewhere",
      label: "Elsewhere",
      locationId: fx.ids.staffUserId,
      acceptsRfid: true,
    });
    expect(result).toEqual({ ok: false, error: "Location not found." });
  });

  it("refuses a caller who cannot manage gate access", async () => {
    const result = await fx.services.devices.registerGateDevice(receptionist(), {
      deviceKey: "desk",
      label: "Desk Gate",
      locationId: fx.ids.locationId,
      acceptsRfid: true,
    });
    expect(result.ok).toBe(false);
  });

  it("lists only this academy's gates", async () => {
    const mine = await fx.services.devices.listGateDevices(owner());
    expect(mine.map((d) => d.deviceKey).sort()).toEqual(
      ["court1", "court2", "court3", "main", "reception"].sort(),
    );

    const theirs = await fx.services.devices.listGateDevices(
      owner(fx.ids.otherTenantId),
    );
    expect(theirs.map((d) => d.deviceKey)).toEqual(["main"]);
  });

  it("refuses to list the gates to a caller who cannot manage gate access", async () => {
    const result = await fx.services.devices.listGateDevices(receptionist());
    expect(result).toEqual([]);
  });
});

describe("mock access — the credential list", () => {
  it("lists a member's credentials without their digests", async () => {
    const rows = await fx.services.credentials.listGateCredentials(
      owner(),
      fx.ids.memberBooked,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).not.toHaveProperty("secretHash");
      expect(Object.keys(row).sort()).toEqual([
        "id",
        "kind",
        "label",
        "memberId",
        "status",
      ]);
    }
  });

  it("lists nothing for another academy's member", async () => {
    const rows = await fx.services.credentials.listGateCredentials(
      owner(fx.ids.otherTenantId),
      fx.ids.memberBooked,
    );
    expect(rows).toEqual([]);
  });

  it("refuses to list a member's cards to a caller who cannot manage gate access", async () => {
    const rows = await fx.services.credentials.listGateCredentials(
      receptionist(),
      fx.ids.memberBooked,
    );
    expect(rows).toEqual([]);
  });
});
