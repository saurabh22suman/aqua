import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { enquiries, type EnquirySource } from "@/db/schema/enquiries";
import { locations } from "@/db/schema/locations";
import type { ActionCtx } from "@/lib/auth/context";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { toEnquiryRow, type EnquiryRow } from "@/lib/services/enquiry-scope";
import { auditEnquiryCreated } from "@/lib/services/enquiry-audit";

// C-12 — enquiry capture.
//
// C-12 done-when: "a walk-in is captured in under thirty seconds" --
// three required fields (name, source) plus an optional phone. DOB,
// consent, guardian resolution all wait until a trial is actually
// booked (bookTrial) or the enquiry converts without one
// (convertEnquiry) -- neither is needed just to log that someone
// asked.
//
// R04 — the capture site is required and must be inside the caller's
// allowed locations. A counter enquiry is always at the site where it
// was taken, so there is no legitimate unassigned creation path; the
// NULL location state exists only for historical rows.
//
// The TS input stays optional for internal/system callers and
// protected fixtures (tests/tier1/** is agent-read-only), but every
// app path goes through createEnquiryAction, whose Zod schema requires
// locationId, so a receptionist can never create an unassigned row.
// An omitted site from an internal caller stores NULL, which the
// visibility predicate treats as management-review-only.
export async function createEnquiry(
  ctx: ActionCtx,
  input: { fullName: string; phone?: string; source: EnquirySource; notes?: string; locationId?: string },
): Promise<EnquiryRow> {
  return withTenant(ctx.tenantId, async (tx) => {
    const locationId = input.locationId ?? null;
    if (locationId) {
      const access = await resolveLocationAccess(tx, ctx);
      const [location] = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(
          and(
            eq(locations.id, locationId as never),
            eq(locations.tenantId, ctx.tenantId),
            isNull(locations.deletedAt),
          ),
        )
        .limit(1);
      if (!location || !locationVisible(access, locationId)) {
        throw new Error("Choose a location you have access to.");
      }
    }

    const [row] = await tx
      .insert(enquiries)
      .values({
        tenantId: ctx.tenantId,
        fullName: input.fullName,
        phone: input.phone,
        source: input.source,
        notes: input.notes,
        locationId: locationId as never,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    // The capture's audit row goes in the SAME transaction as the
    // insert: a captured enquiry can never exist without its record.
    await auditEnquiryCreated(tx, ctx, {
      id: row.id,
      source: row.source,
      stage: row.stage,
      locationId: row.locationId,
    });
    return toEnquiryRow(row);
  });
}
