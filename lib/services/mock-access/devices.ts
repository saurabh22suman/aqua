// Mock-only gate access — the gate device registry.
//
// A gate is a row: which tenant it belongs to, which location it
// stands at, which facility (and which court inside it) it opens, and
// which credential methods it reads.
//
// The facility binding is the heart of the model. A gate with no
// facility is the premises gate and accepts a PIN or an RFID tag; a
// gate bound to a facility (and optionally to one court inside it)
// accepts RFID only and opens for that court alone.

import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantTx } from "@/db/tenant";
import { gateDevices } from "@/db/schema/mock-access";
import { facilities, facilitySubUnits } from "@/db/schema/preset-engine";
import { locations } from "@/db/schema/locations";
import { writeAudit } from "@/lib/audit/write";
import type { TenantId } from "@/lib/ids";
import { GATE_FORBIDDEN, gateActorMayManage, type GateActor } from "./actor";

export type GateDeviceRow = {
  id: string;
  deviceKey: string;
  label: string;
  locationId: string;
  facilityId: string | null;
  subUnitId: string | null;
  acceptsPin: boolean;
  acceptsRfid: boolean;
  status: "active" | "disabled";
};

export const registerGateDeviceInput = z.object({
  deviceKey: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  label: z.string().trim().min(1).max(120),
  locationId: z.string().uuid(),
  facilityId: z.string().uuid().nullish(),
  subUnitId: z.string().uuid().nullish(),
  acceptsPin: z.boolean().optional(),
  acceptsRfid: z.boolean().optional(),
});

export type RegisterGateDeviceResult =
  | { ok: true; deviceId: string }
  | { ok: false; error: string };

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid gate.";
}

// The shared read, inside a caller's transaction. The scan path uses
// this so the device, the decision and the log row are one transaction.
export async function deviceByKeyInTx(
  tx: TenantTx,
  tenantId: TenantId,
  deviceKey: string,
): Promise<GateDeviceRow | null> {
  const rows = await tx
    .select({
      id: gateDevices.id,
      deviceKey: gateDevices.deviceKey,
      label: gateDevices.label,
      locationId: gateDevices.locationId,
      facilityId: gateDevices.facilityId,
      subUnitId: gateDevices.subUnitId,
      acceptsPin: gateDevices.acceptsPin,
      acceptsRfid: gateDevices.acceptsRfid,
      status: gateDevices.status,
      facilityDeletedAt: facilities.deletedAt,
      subUnitDeletedAt: facilitySubUnits.deletedAt,
    })
    .from(gateDevices)
    .leftJoin(
      facilities,
      and(
        eq(facilities.id, gateDevices.facilityId),
        eq(facilities.tenantId, gateDevices.tenantId),
      ),
    )
    .leftJoin(
      facilitySubUnits,
      and(
        eq(facilitySubUnits.id, gateDevices.subUnitId),
        eq(facilitySubUnits.tenantId, gateDevices.tenantId),
      ),
    )
    .where(
      and(
        eq(gateDevices.tenantId, tenantId),
        eq(gateDevices.deviceKey, deviceKey),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  // A gate whose facility or court has been retired does not open. The
  // gate row survives (its history matters), but the court it served
  // does not.
  const retired =
    row.facilityDeletedAt !== null || row.subUnitDeletedAt !== null;
  return {
    id: row.id,
    deviceKey: row.deviceKey,
    label: row.label,
    locationId: row.locationId,
    facilityId: row.facilityId,
    subUnitId: row.subUnitId,
    acceptsPin: row.acceptsPin,
    acceptsRfid: row.acceptsRfid,
    status: retired ? "disabled" : row.status,
  };
}

export async function registerGateDevice(
  actor: GateActor,
  raw: unknown,
): Promise<RegisterGateDeviceResult> {
  if (!gateActorMayManage(actor)) return { ok: false, error: GATE_FORBIDDEN };
  const parsed = registerGateDeviceInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;

  const acceptsPin = input.acceptsPin ?? false;
  const acceptsRfid = input.acceptsRfid ?? false;
  if (!acceptsPin && !acceptsRfid) {
    return {
      ok: false,
      error: "A gate must accept a PIN, an RFID tag, or both.",
    };
  }
  if (input.subUnitId && !input.facilityId) {
    return {
      ok: false,
      error: "A gate bound to a court must name the facility it belongs to.",
    };
  }

  return withTenant(actor.tenantId, async (tx) => {
    const [location] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(
          eq(locations.id, input.locationId),
          eq(locations.tenantId, actor.tenantId),
          isNull(locations.deletedAt),
        ),
      )
      .limit(1);
    if (!location) return { ok: false, error: "Location not found." };

    if (input.facilityId) {
      const [facility] = await tx
        .select({ id: facilities.id, locationId: facilities.locationId })
        .from(facilities)
        .where(
          and(
            eq(facilities.id, input.facilityId),
            eq(facilities.tenantId, actor.tenantId),
            isNull(facilities.deletedAt),
          ),
        )
        .limit(1);
      if (!facility) return { ok: false, error: "Facility not found." };
      // A gate stands at a location; the facility it opens lives at one.
      // A gate bound to another location's facility could never match a
      // booking, and would be a silent dead gate.
      if (facility.locationId !== input.locationId) {
        return { ok: false, error: "That facility is not at this location." };
      }
    }

    if (input.subUnitId) {
      const [subUnit] = await tx
        .select({ id: facilitySubUnits.id })
        .from(facilitySubUnits)
        .where(
          and(
            eq(facilitySubUnits.id, input.subUnitId),
            eq(facilitySubUnits.tenantId, actor.tenantId),
            eq(facilitySubUnits.facilityId, input.facilityId!),
            isNull(facilitySubUnits.deletedAt),
          ),
        )
        .limit(1);
      if (!subUnit) {
        return { ok: false, error: "That court is not part of this facility." };
      }
    }

    const [existing] = await tx
      .select({ id: gateDevices.id })
      .from(gateDevices)
      .where(
        and(
          eq(gateDevices.tenantId, actor.tenantId),
          eq(gateDevices.deviceKey, input.deviceKey),
        ),
      )
      .limit(1);
    if (existing) {
      return { ok: false, error: "This academy already has that gate." };
    }

    const [row] = await tx
      .insert(gateDevices)
      .values({
        tenantId: actor.tenantId,
        locationId: input.locationId,
        deviceKey: input.deviceKey,
        label: input.label,
        facilityId: input.facilityId ?? null,
        subUnitId: input.subUnitId ?? null,
        acceptsPin,
        acceptsRfid,
        status: "active",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: gateDevices.id });
    if (!row) return { ok: false, error: "The gate could not be saved." };

    await writeAudit(tx, {
      tenantId: actor.tenantId,
      actorType: "user",
      actorId: actor.userId,
      requestId: actor.requestId ?? null,
      action: "gate.device.register",
      entityType: "gate_device",
      entityId: row.id,
      after: {
        deviceKey: input.deviceKey,
        label: input.label,
        locationId: input.locationId,
        facilityId: input.facilityId ?? null,
        subUnitId: input.subUnitId ?? null,
        acceptsPin,
        acceptsRfid,
      },
    });

    return { ok: true, deviceId: row.id };
  });
}

export async function listGateDevices(
  actor: GateActor,
): Promise<GateDeviceRow[]> {
  if (!gateActorMayManage(actor)) return [];
  return withTenant(actor.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: gateDevices.id,
        deviceKey: gateDevices.deviceKey,
        label: gateDevices.label,
        locationId: gateDevices.locationId,
        facilityId: gateDevices.facilityId,
        subUnitId: gateDevices.subUnitId,
        acceptsPin: gateDevices.acceptsPin,
        acceptsRfid: gateDevices.acceptsRfid,
        status: gateDevices.status,
      })
      .from(gateDevices)
      .where(eq(gateDevices.tenantId, actor.tenantId));
    return rows;
  });
}
