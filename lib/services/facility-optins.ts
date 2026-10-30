import { and, asc, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { memberFacilityOptins } from "@/db/schema/facility-optins";
import { locations } from "@/db/schema/locations";
import { members } from "@/db/schema/people";
import { tenants } from "@/db/schema/tenants";
import { auditActorOf, writeAudit } from "@/lib/audit/write";
import { todayInZone } from "@/lib/time/tz";
import type { ActionCtx } from "@/lib/auth/context";
import { asMemberId } from "@/lib/ids";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";

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
    // O-08 — a facility opt-in is a location-scoped write: the member
    // and the facility must both be inside the caller's allowed
    // locations. An out-of-scope row is reported as "not found", never
    // as forbidden (the shape used by member-registration.ts and
    // shifts.ts).
    const access = await resolveLocationAccess(tx, ctx);
    const [member] = await tx
      .select({ id: members.id, locationId: members.locationId })
      .from(members)
      .where(
        and(
          eq(members.id, asMemberId(input.memberId)),
          eq(members.tenantId, ctx.tenantId),
          isNull(members.deletedAt),
        ),
      );
    if (!member || !locationVisible(access, member.locationId)) {
      return { ok: false, error: "Member not found." };
    }

    const [location] = await tx
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(
        and(
          eq(locations.id, input.locationId),
          eq(locations.tenantId, ctx.tenantId),
          isNull(locations.deletedAt),
        ),
      );
    if (!location || !locationVisible(access, location.id)) {
      return { ok: false, error: "Facility not found." };
    }

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

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      ...auditActorOf(ctx),
      action: "member_facility.add",
      entityType: "member_facility_optin",
      entityId: row!.id,
      after: { memberId: input.memberId, locationId: input.locationId, optedOn },
    });

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
    const access = await resolveLocationAccess(tx, ctx);

    // O-08 — the opt-in being ended must be inside the caller's
    // locations: the facility it names and the member it belongs to.
    // The check runs before the write, so a refusal changes nothing.
    const [existing] = await tx
      .select({
        id: memberFacilityOptins.id,
        memberId: memberFacilityOptins.memberId,
        locationId: memberFacilityOptins.locationId,
      })
      .from(memberFacilityOptins)
      .where(
        and(
          eq(memberFacilityOptins.id, input.optinId),
          eq(memberFacilityOptins.tenantId, ctx.tenantId),
          isNull(memberFacilityOptins.endedOn),
        ),
      )
      .limit(1);
    if (!existing || !locationVisible(access, existing.locationId)) {
      return { ok: false, error: "Opt-in not found or already ended." };
    }
    const [owner] = await tx
      .select({ locationId: members.locationId })
      .from(members)
      .where(
        and(
          eq(members.id, existing.memberId),
          eq(members.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    if (!owner || !locationVisible(access, owner.locationId)) {
      return { ok: false, error: "Opt-in not found or already ended." };
    }

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

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      ...auditActorOf(ctx),
      action: "member_facility.end",
      entityType: "member_facility_optin",
      entityId: input.optinId,
      after: {
        memberId: row.memberId,
        locationId: row.locationId,
        endedOn,
      },
    });

    return { ok: true };
  });
}
