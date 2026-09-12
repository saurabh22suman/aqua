import { and, asc, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { memberFacilityOptins } from "@/db/schema/facility-optins";
import { locations } from "@/db/schema/locations";
import { members } from "@/db/schema/people";
import { tenants } from "@/db/schema/tenants";
import { auditLog } from "@/db/schema/audit";
import { todayInZone } from "@/lib/time/tz";
import type { ActionCtx } from "@/lib/auth/context";
import { asMemberId } from "@/lib/ids";

// Wave 2 (docs/role-surfaces-plan.md) — member facility opt-ins.
// members.location_id stays the home facility; these rows record the
// additional facilities a member opts into. Billing (per-facility,
// C-29 → C-33) will reference this table when it lands.
//
// Every mutation writes audit_log in the same transaction, per the
// AGENTS.md absolute rule. The actor is optional on ActionCtx because
// seeds/tests construct contexts without one; when present it is
// recorded.

export type OptedFacilityRow = {
  optinId: string;
  locationId: string;
  locationName: string;
  optedOn: string;
};

export async function listOptedFacilities(
  ctx: ActionCtx,
  memberId: string,
): Promise<OptedFacilityRow[]> {
  return withTenant(ctx.tenantId, (tx) =>
    tx
      .select({
        optinId: memberFacilityOptins.id,
        locationId: memberFacilityOptins.locationId,
        locationName: locations.name,
        optedOn: memberFacilityOptins.optedOn,
      })
      .from(memberFacilityOptins)
      .innerJoin(locations, eq(locations.id, memberFacilityOptins.locationId))
      .where(
        and(
          eq(memberFacilityOptins.tenantId, ctx.tenantId),
          eq(memberFacilityOptins.memberId, asMemberId(memberId)),
          isNull(memberFacilityOptins.endedOn),
        ),
      )
      .orderBy(asc(memberFacilityOptins.optedOn)),
  );
}

export async function addMemberFacility(
  ctx: ActionCtx,
  input: { memberId: string; locationId: string; optedOn?: string },
): Promise<{ ok: true; row: OptedFacilityRow } | { ok: false; error: string }> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [member] = await tx
      .select({ id: members.id })
      .from(members)
      .where(
        and(
          eq(members.id, asMemberId(input.memberId)),
          eq(members.tenantId, ctx.tenantId),
          isNull(members.deletedAt),
        ),
      );
    if (!member) return { ok: false, error: "Member not found." };

    const [location] = await tx
      .select({ name: locations.name })
      .from(locations)
      .where(
        and(
          eq(locations.id, input.locationId),
          eq(locations.tenantId, ctx.tenantId),
          isNull(locations.deletedAt),
        ),
      );
    if (!location) return { ok: false, error: "Facility not found." };

    const [existing] = await tx
      .select({ id: memberFacilityOptins.id })
      .from(memberFacilityOptins)
      .where(
        and(
          eq(memberFacilityOptins.tenantId, ctx.tenantId),
          eq(memberFacilityOptins.memberId, asMemberId(input.memberId)),
          eq(memberFacilityOptins.locationId, input.locationId),
          isNull(memberFacilityOptins.endedOn),
        ),
      );
    if (existing) {
      return { ok: false, error: "Already opted into this facility." };
    }

    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const optedOn = input.optedOn ?? todayInZone(tenant.timezone);

    const [row] = await tx
      .insert(memberFacilityOptins)
      .values({
        tenantId: ctx.tenantId,
        memberId: asMemberId(input.memberId),
        locationId: input.locationId,
        optedOn,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: memberFacilityOptins.id });

    if (ctx.userId) {
      await tx.insert(auditLog).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: "member_facility.add",
        entityType: "member_facility_optin",
        entityId: row!.id,
        after: { memberId: input.memberId, locationId: input.locationId, optedOn },
      });
    }

    return {
      ok: true,
      row: {
        optinId: row!.id,
        locationId: input.locationId,
        locationName: location.name,
        optedOn,
      },
    };
  });
}

export async function endMemberFacility(
  ctx: ActionCtx,
  input: { optinId: string; endedOn?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const endedOn = input.endedOn ?? todayInZone(tenant.timezone);

    const [row] = await tx
      .update(memberFacilityOptins)
      .set({ endedOn, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(
        and(
          eq(memberFacilityOptins.id, input.optinId),
          eq(memberFacilityOptins.tenantId, ctx.tenantId),
          isNull(memberFacilityOptins.endedOn),
        ),
      )
      .returning({
        memberId: memberFacilityOptins.memberId,
        locationId: memberFacilityOptins.locationId,
      });
    if (!row) return { ok: false, error: "Opt-in not found or already ended." };

    if (ctx.userId) {
      await tx.insert(auditLog).values({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        action: "member_facility.end",
        entityType: "member_facility_optin",
        entityId: input.optinId,
        after: {
          memberId: row.memberId,
          locationId: row.locationId,
          endedOn,
        },
      });
    }

    return { ok: true };
  });
}
