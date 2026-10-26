// Mock-only gate access — gathering the facts a decision needs.
//
// The policy in policy.ts is pure: it decides from facts. This module
// is the only place those facts are read from the database, so the
// scan service stays about flow (idempotency, decision, log) and the
// read set stays in one reviewable place.
//
// Every read here is tenant-scoped through the caller's transaction
// (withTenant), and RLS is the second lock on the same rows.

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { bookings } from "@/db/schema/bookings";
import { members } from "@/db/schema/people";
import { subscriptions } from "@/db/schema/subscriptions";
import { asMemberId, type TenantId } from "@/lib/ids";
import { todayInZone } from "@/lib/time/tz";
import { tenantTimezoneInTx } from "@/lib/services/tenant-timezone";
import type {
  GateBookingFacts,
  GateDeviceFacts,
  GateSubscriptionFacts,
} from "./policy";
import type { GateDeviceRow } from "./devices";

export type GateFacts = {
  device: GateDeviceFacts;
  /** null when the member row is gone or soft-deleted. */
  memberStatus: string | null;
  /** The tenant-local day the membership windows are compared against. */
  today: string;
  bookings: GateBookingFacts[];
  subscriptions: GateSubscriptionFacts[];
};

export async function gatherGateFacts(
  tx: TenantTx,
  tenantId: TenantId,
  device: GateDeviceRow,
  memberId: string | null,
  now: Date,
): Promise<GateFacts> {
  let memberStatus: string | null = null;
  if (memberId) {
    const memberRows = await tx
      .select({ status: members.status })
      .from(members)
      .where(
        and(
          eq(members.id, asMemberId(memberId)),
          eq(members.tenantId, tenantId),
          isNull(members.deletedAt),
        ),
      )
      .limit(1);
    memberStatus = memberRows[0]?.status ?? null;
  }

  const bookingRows = memberId
    ? await tx
        .select({
          locationId: bookings.locationId,
          facilityId: bookings.facilityId,
          subUnitId: bookings.subUnitId,
          startsAt: bookings.startsAt,
          endsAt: bookings.endsAt,
        })
        .from(bookings)
        .where(
          and(
            eq(bookings.tenantId, tenantId),
            eq(bookings.memberId, asMemberId(memberId)),
            eq(bookings.locationId, device.locationId),
            inArray(bookings.status, ["held", "confirmed"]),
          ),
        )
    : [];

  const subscriptionRows = memberId
    ? await tx
        .select({
          locationId: subscriptions.locationId,
          activityId: subscriptions.activityId,
          startsOn: subscriptions.startsOn,
          endsOn: subscriptions.endsOn,
          status: subscriptions.status,
        })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.tenantId, tenantId),
            eq(subscriptions.memberId, asMemberId(memberId)),
            eq(subscriptions.locationId, device.locationId),
          ),
        )
    : [];

  const timezone = await tenantTimezoneInTx(tx, tenantId);

  return {
    device: {
      locationId: device.locationId,
      facilityId: device.facilityId,
      subUnitId: device.subUnitId,
      acceptsPin: device.acceptsPin,
      acceptsRfid: device.acceptsRfid,
      status: device.status,
    },
    memberStatus,
    today: todayInZone(timezone, now.getTime()),
    bookings: bookingRows,
    subscriptions: subscriptionRows.map((row) => ({
      locationId: row.locationId,
      activityId: row.activityId,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      status: row.status as "active" | "paused" | "expired" | "cancelled",
    })),
  };
}
