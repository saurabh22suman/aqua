import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantTx } from "@/db/tenant";
import { bookings } from "@/db/schema/bookings";
import { facilities, facilitySubUnits } from "@/db/schema/preset-engine";
import { locations } from "@/db/schema/locations";
import { invoices } from "@/db/schema/invoices";
import { members, persons } from "@/db/schema/people";
import { tenants } from "@/db/schema/tenants";
import {
  locationPredicate,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { dayRangeUtc } from "@/lib/time/tz";
import type { ActionCtx } from "@/lib/auth/context";

// V-02 — the booking read side: the day board and the bookable
// resource list (plus the tenant-timezone lookup both need). Split
// out of lib/services/bookings.ts to keep every file under the
// 300-line rule; bookings.ts re-exports this surface so callers keep
// one import.

const uuid = z.string().uuid();

export async function tenantTimezone(
  tx: TenantTx,
  ctx: ActionCtx,
): Promise<string> {
  const [row] = await tx
    .select({ timezone: tenants.timezone })
    .from(tenants)
    .where(eq(tenants.id, ctx.tenantId))
    .limit(1);
  return row?.timezone ?? "Asia/Kolkata";
}

export const listBookingsForDayInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a yyyy-mm-dd date."),
  facilityId: uuid.optional(),
  locationId: uuid.optional(),
});

export type ListBookingsForDayInput = z.input<typeof listBookingsForDayInput>;

export type BookingDayRow = {
  bookingId: string;
  facilityId: string;
  facilityName: string;
  subUnitId: string | null;
  subUnitName: string | null;
  locationId: string;
  locationName: string;
  memberId: string | null;
  memberName: string | null;
  walkInName: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  pricePaise: number;
  invoiceId: string | null;
  invoiceNumber: string | null;
  amountDuePaise: number;
  billable: boolean;
};

export async function listBookingsForDay(
  ctx: ActionCtx,
  raw: unknown,
): Promise<BookingDayRow[]> {
  const parsed = listBookingsForDayInput.safeParse(raw);
  if (!parsed.success) return [];
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const { fromUtc, toUtc } = dayRangeUtc(
      input.date,
      await tenantTimezone(tx, ctx),
    );
    const predicates = [
      eq(bookings.tenantId, ctx.tenantId),
      gte(bookings.startsAt, fromUtc),
      lt(bookings.startsAt, toUtc),
    ];
    if (input.facilityId) {
      predicates.push(eq(bookings.facilityId, input.facilityId));
    }
    if (input.locationId) {
      predicates.push(eq(bookings.locationId, input.locationId));
    }
    const scoped = locationPredicate(bookings.locationId, access);
    if (scoped) predicates.push(scoped);

    const rows = await tx
      .select({
        booking: bookings,
        facilityName: facilities.name,
        subUnitName: facilitySubUnits.name,
        locationName: locations.name,
        memberName: persons.fullName,
        invoice: invoices,
      })
      .from(bookings)
      .innerJoin(
        facilities,
        and(
          eq(facilities.id, bookings.facilityId),
          eq(facilities.tenantId, ctx.tenantId),
        ),
      )
      .innerJoin(
        locations,
        and(
          eq(locations.id, bookings.locationId),
          eq(locations.tenantId, ctx.tenantId),
        ),
      )
      .leftJoin(
        facilitySubUnits,
        and(
          eq(facilitySubUnits.id, bookings.subUnitId),
          eq(facilitySubUnits.tenantId, ctx.tenantId),
        ),
      )
      .leftJoin(
        members,
        and(
          eq(members.id, bookings.memberId),
          eq(members.tenantId, ctx.tenantId),
        ),
      )
      .leftJoin(persons, eq(persons.id, members.personId))
      .leftJoin(
        invoices,
        and(
          eq(invoices.id, bookings.invoiceId),
          eq(invoices.tenantId, ctx.tenantId),
        ),
      )
      .where(and(...predicates))
      .orderBy(asc(bookings.startsAt), asc(bookings.id));

    return rows.map((row) => {
      const invoice = row.invoice;
      const billed = row.booking.invoiceId !== null && invoice !== null;
      const total = billed ? Number(invoice.totalPaise) : 0;
      const paid = billed ? Number(invoice.paidPaise) : 0;
      return {
        bookingId: row.booking.id,
        facilityId: row.booking.facilityId,
        facilityName: row.facilityName,
        subUnitId: row.booking.subUnitId,
        subUnitName: row.subUnitName,
        locationId: row.booking.locationId,
        locationName: row.locationName,
        memberId: row.booking.memberId,
        memberName: row.memberName,
        walkInName: row.booking.walkInName,
        startsAt: row.booking.startsAt.toISOString(),
        endsAt: row.booking.endsAt.toISOString(),
        status: row.booking.status,
        pricePaise: Number(row.booking.pricePaise),
        invoiceId: billed ? row.booking.invoiceId : null,
        invoiceNumber: billed ? invoice.invoiceNumber : null,
        amountDuePaise: billed ? Math.max(0, total - paid) : 0,
        billable:
          row.booking.memberId !== null && row.booking.status !== "cancelled",
      };
    });
  });
}

export type BookableFacility = {
  id: string;
  name: string;
  kind: string;
  capacity: number;
  locationId: string;
  locationName: string;
  subUnits: Array<{ id: string; name: string }>;
};

export async function listBookableFacilities(
  ctx: ActionCtx,
): Promise<BookableFacility[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const predicates = [
      eq(facilities.tenantId, ctx.tenantId),
      isNull(facilities.deletedAt),
    ];
    const scoped = locationPredicate(facilities.locationId, access);
    if (scoped) predicates.push(scoped);

    const rows = await tx
      .select({
        facility: facilities,
        locationName: locations.name,
      })
      .from(facilities)
      .innerJoin(
        locations,
        and(
          eq(locations.id, facilities.locationId),
          eq(locations.tenantId, ctx.tenantId),
        ),
      )
      .where(and(...predicates))
      .orderBy(asc(locations.name), asc(facilities.name));

    if (rows.length === 0) return [];
    const units = await tx
      .select({
        id: facilitySubUnits.id,
        facilityId: facilitySubUnits.facilityId,
        name: facilitySubUnits.name,
      })
      .from(facilitySubUnits)
      .where(
        and(
          eq(facilitySubUnits.tenantId, ctx.tenantId),
          inArray(
            facilitySubUnits.facilityId,
            rows.map((row) => row.facility.id),
          ),
          isNull(facilitySubUnits.deletedAt),
        ),
      )
      .orderBy(asc(facilitySubUnits.name));

    return rows.map((row) => ({
      id: row.facility.id,
      name: row.facility.name,
      kind: row.facility.kind,
      capacity: row.facility.capacity,
      locationId: row.facility.locationId,
      locationName: row.locationName,
      subUnits: units
        .filter((unit) => unit.facilityId === row.facility.id)
        .map((unit) => ({ id: unit.id, name: unit.name })),
    }));
  });
}
