import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { bookings } from "@/db/schema/bookings";
import { tenants } from "@/db/schema/tenants";
import { resolveConfigInTx } from "@/db/config";
import { writeAudit } from "@/lib/audit/write";
import { gstDocumentKind } from "@/lib/gst";
import { GST_RATE_KEY } from "@/lib/services/tax";
import { issueInvoiceInTx, SAC_CODE_KEY } from "@/lib/services/invoice-issue";
import { formatTimeIST, todayInZone } from "@/lib/time/tz";
import {
  buildBill,
  loadBooking,
  splitInclusivePrice,
  type BookingBillResult,
} from "@/lib/services/booking-bill-view";
import type { ActionCtx } from "@/lib/auth/context";

// V-04 — the booking → invoice bridge. Mirrors the café split (K-08):
// Request bill issues exactly one invoice (source 'other', configured
// SAC and GST rate snapshotted at issue), the bill shows the amount
// due, and the existing payment panel collects it. The read side
// (buildBill/readBookingBill, the inclusive split) lives in
// lib/services/booking-bill-view.ts and is re-exported below.
//
// A walk-in booking has no member_id and the invoice spine has no
// anonymous path: the bill request refuses with the reason, exactly
// as the café does. Billing locks the booking row, so two concurrent
// requests issue one invoice, not two.

export * from "./booking-bill-view";

export const WALK_IN_BILL_ERROR =
  "A walk-in booking is not payable in R1 — attach a member to bill it.";

export async function requestBookingBill(
  ctx: ActionCtx,
  bookingId: string,
): Promise<BookingBillResult> {
  const parsed = z.string().uuid().safeParse(bookingId);
  if (!parsed.success) return { ok: false, error: "Invalid booking." };
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  const actorId = ctx.userId;

  return withTenant(ctx.tenantId, async (tx) => {
    const context = await loadBooking(tx, ctx, parsed.data, {
      forUpdate: true,
    });
    if (!context) return { ok: false, error: "Booking not found." };
    const { booking, facilityName, subUnitName, memberName } = context;

    if (booking.status === "cancelled") {
      return { ok: false, error: "Cancelled bookings cannot be billed." };
    }
    if (!booking.memberId) {
      return { ok: false, error: WALK_IN_BILL_ERROR };
    }
    if (booking.invoiceId) {
      return buildBill(
        tx,
        ctx,
        booking,
        facilityName,
        subUnitName,
        memberName,
      );
    }

    const [tenantRow] = await tx
      .select({ gstin: tenants.gstin, timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    if (!tenantRow) return { ok: false, error: "Tenant not found." };
    const documentKind = gstDocumentKind(tenantRow.gstin);

    const { value: sacCode } = await resolveConfigInTx<string>(
      tx,
      ctx.tenantId,
      SAC_CODE_KEY,
      { locationId: booking.locationId },
    );
    let rateBp = 0;
    if (documentKind === "tax_invoice") {
      const resolved = await resolveConfigInTx<number>(
        tx,
        ctx.tenantId,
        GST_RATE_KEY,
        { locationId: booking.locationId },
      );
      rateBp = resolved.value;
    }

    const split = splitInclusivePrice(Number(booking.pricePaise), rateBp);
    const description = `Booking: ${facilityName}${
      subUnitName ? ` · ${subUnitName}` : ""
    } · ${formatTimeIST(booking.startsAt)}–${formatTimeIST(booking.endsAt)}`;
    const issuedOn = todayInZone(tenantRow.timezone);

    const issued = await issueInvoiceInTx(
      tx,
      {
        tenantId: ctx.tenantId,
        memberId: booking.memberId,
        locationId: booking.locationId,
        issuedOn,
        dueOn: issuedOn,
        source: "other",
        lines: [
          {
            description,
            amountPaise: split.base,
            sacCode,
            taxRateBp: rateBp,
            taxPaise: split.tax,
          },
        ],
      },
      actorId,
    );
    if (!issued.ok) return { ok: false, error: issued.error };

    await tx
      .update(bookings)
      .set({
        invoiceId: issued.invoiceId,
        updatedBy: actorId,
        updatedAt: new Date(),
      })
      .where(
        and(eq(bookings.id, booking.id), eq(bookings.tenantId, ctx.tenantId)),
      );

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId,
      requestId: ctx.requestId ?? null,
      action: "booking.bill",
      entityType: "booking",
      entityId: booking.id,
      before: { invoiceId: null },
      after: {
        invoiceId: issued.invoiceId,
        invoiceNumber: issued.invoiceNumber,
        totalPaise: issued.totalPaise,
      },
    });

    const built = await buildBill(
      tx,
      ctx,
      { ...booking, invoiceId: issued.invoiceId },
      facilityName,
      subUnitName,
      memberName,
    );
    if (!built.ok) return built;
    return { ok: true, bill: built.bill, alreadyBilled: false };
  });
}
