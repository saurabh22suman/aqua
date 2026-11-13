import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { bookings } from "@/db/schema/bookings";
import { tenants } from "@/db/schema/tenants";
import { resolveConfigInTx } from "@/db/config";
import { isFeatureEnabledForTenant } from "@/db/features";
import { writeAudit } from "@/lib/audit/write";
import { gstDocumentKind } from "@/lib/gst";
import { GST_RATE_KEY } from "@/lib/services/tax";
import { issueInvoiceInTx, SAC_CODE_KEY } from "@/lib/services/invoice-issue";
import { formatTimeIST, todayInZone } from "@/lib/time/tz";
import {
  buildBill,
  loadBooking,
  loadLinkedInvoice,
  splitInclusivePrice,
  type BookingBillResult,
} from "@/lib/services/booking-bill-view";
import type { ActionCtx } from "@/lib/auth/context";

// FINAL DECISION (2026-11-05, completion pass): WR-9 is now DECIDED for this
// release. An already-paid invoice is kept AS ISSUED and paid buyer/name
// corrections are DEFERRED; no refund, reversal, credit note or adjustment
// document is introduced. The comments below that still call WR-9 "open" or
// "undefined" are historical context. The authoritative note is
// docs/design/parallel-release/walk-in-approval/completion-20261105/README.md.
//
// V-04 — the booking → invoice bridge. Mirrors the café split (K-08):
// Request bill issues exactly one invoice (source 'other', configured
// SAC and GST rate snapshotted at issue), the bill shows the amount
// due, and the existing payment panel collects it. The read side
// (buildBill/readBookingBill, the inclusive split) lives in
// lib/services/booking-bill-view.ts and is re-exported below.
//
// WR-1 / Option A — a walk-in booking IS billable (the human's
// decision, 2026-11-05). The booking has exactly one of a member or a
// walk-in name (the table's own check), and the payer is resolved
// HERE, once: this is the only place in the codebase that decides who
// a walk-in bill is addressed to. The guest's own name travels on the
// invoice (guest_name) and on the line description; no member record
// is invented for them.
//
// Billing locks the booking row, so two concurrent requests issue one
// invoice, not two.
//
// CORRECTION PASS (2026-11-05) — the line description is composed
// BOUNDED, and never at the buyer's expense. See
// composeBookingLineDescription below and
// docs/design/parallel-release/walk-in-approval/corrections-20261105/README.md.
//
// DECISION PASS (2026-11-05) — A WRONGLY-BILLED DOCUMENT IS CORRECTED
// BY VOIDING AND REISSUING, NEVER BY EDITING IT.
//
// The human's decision: an issued walk-in invoice with the wrong buyer,
// and a typo in its guest name, are corrected by voiding the document
// and issuing a new one. The issued document's identity is therefore
// FIXED — the database refuses any rewrite of payer_kind, member_id or
// guest_name (db/migrations/20261105120000_invoice_guest_payer.sql,
// invoices_payer_immutable_trg) — and this file carries the second half
// of the correction: the REPLACEMENT.
//
// WHY THE REPLACEMENT IS SAFE:
//
//   * the VOIDED document is kept (a legal document is never deleted),
//     it keeps its own number and its own invoice.void audit row;
//   * the booking points at exactly ONE live invoice at any time. The
//     booking row is the only link to a document (there is no
//     invoices.booking_id column), and this function holds the booking
//     row's lock while it moves the pointer, so two concurrent bill
//     requests still produce one replacement, not two;
//   * the replacement is a NEW document with a NEW invoice number, so
//     there is no second live invoice and no second document claiming
//     the same number;
//   * the replacement takes the payer from the BOOKING (the working
//     record), not from the voided document — the voided document's
//     identity is fixed, and the new one is built from the truth;
//   * the audit row names BOTH documents (before: the voided one, after:
//     the replacement), so the chain is visible without a second live
//     invoice. No new audit action and no new permission.
//
// WHAT THIS FILE DOES NOT DO, AND WHY:
//
//   * it does not void anything. voidInvoice is a management act
//     (settings.manage — owner/admin) and it REFUSES a document that
//     has money recorded against it ("Payments are recorded against
//     this invoice; it cannot be voided." — lib/services/invoice-mutations.ts).
//     A replacement is only ever issued for a document that was ALREADY
//     voided, and a voided document cannot carry money;
//   * it does not refund, reverse or credit-note anything. The
//     correction workflow for a PAID invoice is NOT DEFINED in the
//     product, and inventing one here would be a product decision this
//     lane is not authorised to take (WR-9);
//   * it does not edit the voided document. Nothing here can: the
//     database refuses it.
//
// The full reasoning is in
// docs/design/parallel-release/walk-in-approval/decision-20261105/README.md.
//
// ---------------------------------------------------------------------------
// WR-12 PASS (2026-11-05) — WHERE THE CORRECTED NAME COMES FROM.
//
// The decision pass left one gap open and named it: the replacement is
// issued FROM THE BOOKING, and `bookings.walk_in_name` is not editable
// after creation (lib/services/bookings.ts creates and cancels, never
// edits). So "void, then reissue" could correct a wrongly-billed PAYER
// KIND — the booking knows the truth, exactly one of a member and a
// walk-in name — but it could NOT correct a typo in the guest's name:
// the replacement reproduced the same wrong name.
//
// THIS PASS CLOSES THAT GAP WITH A ONE-TIME REPLACEMENT INPUT:
//
//   requestBookingBill(ctx, bookingId, { guestName }) — the corrected
//   buyer's name is an ARGUMENT to the reissue, not a write to the
//   booking. It lands on the NEW document (invoices.guest_name and the
//   line description) and in the audit trail, and the booking is left
//   exactly as it was.
//
// WHY AN INPUT AND NOT AN EDITED BOOKING — the short version; the long
// version is in
// docs/design/parallel-release/walk-in-approval/reissue-name-20261105/README.md
// §2:
//
//   * the corrected value is destined for a LEGAL DOCUMENT, and the
//     document is the authority for the buyer's name (WR-2). It lands
//     where it is meant to land and nowhere else;
//   * the booking stays immutable. The product creates a booking and
//     cancels it; it never edits it. An edit would make a booked record
//     — "who was on the court" — rewritable after the fact, and would
//     change what every other surface shows (the day board, the entry
//     pass, the dues list);
//   * the input is INERT unless an owner/admin has already voided the
//     document. The void (settings.manage) is the escalation; the
//     counter (payments.record + the pool.booking entitlement) may
//     only transcribe the corrected name onto the replacement. That is
//     the two-key structure, and it needs no new permission;
//   * a general "correct the walk-in name" edit would be a
//     GENERAL-PURPOSE mutation that also applies to a booking whose
//     document is PAID — and the paid case is undefined (WR-9). Tying
//     the edit to the void is what keeps that hole shut, and at that
//     point the edit is the correction flow with an extra write.
//
// THE RULES, IN ONE PLACE (the service is the boundary; the action
// does not decide any of them):
//
//   * the corrected name applies to a GUEST booking only. A member
//     booking's buyer name comes from the member's own person record
//     (WR-2), so there is nothing to correct and nothing to type;
//   * the corrected name applies to a REPLACEMENT only — a booking
//     whose document an owner has voided. It is REFUSED, never
//     silently ignored, everywhere else;
//   * the payer KIND is never taken from the input. It is resolved
//     from the booking, exactly as at first issue, so a corrected name
//     can never re-point a bill to a different payer;
//   * the corrected name NEVER changes the amount, the tax split, the
//     SAC code, the location or the number. Only the name on the
//     document changes.
//
// WHAT THIS PASS STILL DOES NOT DO:
//
//   * it does not define a correction workflow for a PAID invoice
//     (WR-9). A document with money on it cannot be voided, so it can
//     never reach the replacement branch, and the corrected name is
//     refused on it;
//   * it does not add a permission, an audit action, a table, a column
//     or a migration. The schema is untouched;
//   * it does not change the booking's own name. The operational
//     record and the financial record can therefore differ, and the
//     bill panel, the fees ledger and the receipt all read the
//     DOCUMENT's name — the booking's name stays what the desk wrote
//     down at the slot. That divergence is a product question, not
//     this lane's to settle (WR-15).

export * from "./booking-bill-view";

// F06 (staging blocker, 29 October 2026) — the booking module's
// entitlement. The booking permissions ride the `pool.booking` module,
// so the runtime already refuses a booking WRITE when that module is
// off; the BILL did not, because it rides `payments.record`. The
// human's policy is the café's: with the module off there is no new
// bill issuance, and a bill that was already issued stays collectible.
// That is why the gate sits on the issuance branch only — the
// already-issued branch returns above it.
export const BOOKING_FEATURE_KEY = "pool.booking";

export const BOOKING_MODULE_OFF_ERROR =
  "The booking module is switched off for this tenant, so a new booking bill cannot be issued. A bill that was already issued can still be collected.";

/**
 * The buyer's name on a guest document.
 *
 * The bound is the bound the name already has everywhere else: the
 * booking's own database check (bookings_walk_in_name_check: 1..120),
 * the create-booking Zod schema's max(120), and the invoice's own
 * check (invoices_guest_name_length_check: 1..120, added by the
 * correction pass). A corrected name is bound the same way, so it can
 * never be a name no surface can lay out.
 */
export const BUYER_NAME_MAX = 120;

/**
 * The corrected name is refused, loudly, wherever it cannot apply.
 *
 * The point of these messages is that a correction is NEVER silently
 * dropped. A counter member who types a corrected name and gets a
 * success screen must be certain the name is on the document; if it
 * is not, the message says so and says what to do instead.
 */
export const REISSUE_NAME_INVALID_ERROR =
  "The buyer's name must be between 1 and 120 characters.";

export const REISSUE_NAME_MEMBER_ERROR =
  "This booking is billed to a member, so the buyer's name comes from the member's record and cannot be given here.";

export const REISSUE_NAME_ONLY_AFTER_VOID_ERROR =
  "A corrected buyer's name can only be given when replacing a bill an owner has voided.";

export const REISSUE_NAME_LIVE_BILL_ERROR =
  "This booking's bill is live and names a different buyer, so the corrected name was not applied. Ask an owner to void it, then request the bill again with the corrected name.";

/**
 * The paid-live-bill correction is deferred by the human's decision
 * (2026-11-05). This message must NOT send the operator to the unpaid
 * void-and-reissue path: `voidInvoice` refuses a document with money on it.
 */
export const PAID_INVOICE_CORRECTION_DEFERRED_ERROR =
  "This invoice is already paid, so it stays as issued. Paid buyer or name corrections are deferred for this release and are not defined here. Ask an owner to review it.";

/**
 * The invoice line's description — the database's own limit.
 *
 * invoice_line_items_description_check allows 1..300 characters, and
 * issueInvoiceInputSchema's line description is the same max(300). The
 * composed text is
 *
 *     Booking: <facility>[ · <sub-unit>] · <time range>[ · <buyer>]
 *
 * with the buyer's name LAST. That order is the defect this function
 * exists to fix: a long name pushes the tail past the limit, the
 * issue-time schema refuses the line, and the counter is told
 * "String must contain at most 300 character(s)" — a message no
 * operator can act on, for a bill that is perfectly legitimate.
 *
 * WHAT IS AND IS NOT SHORTENED:
 *
 *   * The buyer's name is LEGAL data on the document — it names the
 *     buyer of a tax invoice — so it is kept VERBATIM and is never the
 *     part that is shortened. The authoritative copy of the name is
 *     invoices.guest_name (the invoice's own payer field); the bill
 *     panel, the fees ledger, the invoice detail and the receipt all
 *     read the name from there. The line description is a SUMMARY of
 *     the booking, and it repeats the name for the surfaces that show
 *     only the lines.
 *   * The time range is never shortened either.
 *   * Only the VENUE (facility and sub-unit) may be shortened, and it
 *     is shortened with an explicit "…" so a reader can see that the
 *     line was elided. The venue is a tenant-authored label; the
 *     booking record and the bill panel still carry it in full.
 *
 * WHY IT ALWAYS FITS: a walk-in name is at most 120 characters — the
 * booking's own database check (bookings_walk_in_name_check) and the
 * create-booking Zod schema's max(120) — so the name-bearing part of
 * the description is at most "Booking: " + 120 + " · " + 17 = 149
 * characters, and there is always room for the venue.
 *
 * The member path is UNCHANGED: a member booking puts no buyer name on
 * the line, so its description is byte-for-byte what it was.
 */
export const LINE_DESCRIPTION_MAX = 300;

export type BookingLineDescriptionInput = {
  facilityName: string;
  subUnitName: string | null;
  /** The booking's slot, already rendered for the document. */
  timeRange: string;
  /** The walk-in buyer's legal name, or null for a member booking. */
  guestName: string | null;
};

/**
 * Compose the line description, bounded to the database's limit.
 *
 * Returns null when the description cannot be composed within the
 * limit at all — which the 120-character buyer name makes impossible —
 * so the caller refuses the bill instead of writing a row the database
 * would reject with an opaque error.
 */
export function composeBookingLineDescription(
  input: BookingLineDescriptionInput,
): string | null {
  const prefix = "Booking: ";
  const venue = `${input.facilityName}${
    input.subUnitName ? ` · ${input.subUnitName}` : ""
  }`;
  const tail = ` · ${input.timeRange}${
    input.guestName ? ` · ${input.guestName}` : ""
  }`;

  const room = LINE_DESCRIPTION_MAX - prefix.length - tail.length;
  if (room < 2) {
    // Unreachable for a legal buyer name. The guard is here so that a
    // future change to the name's limit fails closed instead of
    // writing an over-length description.
    return null;
  }

  const venueText =
    venue.length <= room ? venue : `${venue.slice(0, room - 1).trimEnd()}…`;

  return `${prefix}${venueText}${tail}`;
}

/**
 * A voided document that still carries money.
 *
 * voidInvoice refuses to void a document with money recorded against
 * it, so this state must not exist. If it ever does, the correction
 * workflow for it is NOT DEFINED (WR-9): the product has no refund,
 * no credit note and no reversal for it here, and this lane does not
 * invent one. The bill is refused instead.
 */
export const VOIDED_INVOICE_WITH_MONEY_ERROR =
  "This booking's bill was voided but still carries money. Paid corrections are deferred for this release and are not defined here. Ask an owner to review it.";

/**
 * The bill request's optional arguments.
 *
 * `guestName` is the CORRECTED buyer's name for a REPLACEMENT
 * document. It is optional, so every existing caller (the booking
 * screen's "Bill" button, the tests, the other lanes' services) is
 * unchanged and keeps its meaning.
 *
 * It is a REPLACEMENT input, not a booking edit: it names the buyer
 * on the NEW document and it is refused everywhere it cannot apply.
 */
export type BookingBillRequest = {
  /**
   * The corrected buyer's name (1..120 characters, trimmed).
   *
   * Accepted ONLY for a walk-in (guest) booking whose document an
   * owner/admin has voided. Refused for a member booking, for a live
   * bill, and for a booking that has never been billed — each with its
   * own message, never silently ignored.
   */
  guestName?: string | null;
};

export async function requestBookingBill(
  ctx: ActionCtx,
  bookingId: string,
  request: BookingBillRequest = {},
): Promise<BookingBillResult> {
  const parsed = z.string().uuid().safeParse(bookingId);
  if (!parsed.success) return { ok: false, error: "Invalid booking." };
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  // WR-12 — the corrected name is validated HERE, at the service
  // boundary, and not only in the action: the action is one caller, and
  // the service is what every caller uses. An absent name and a blank
  // name are different things — an absent name means "no correction",
  // a blank name is a mistake and is refused.
  let correctedName: string | null = null;
  if (request.guestName !== undefined && request.guestName !== null) {
    const nameParsed = z
      .string()
      .trim()
      .min(1)
      .max(BUYER_NAME_MAX)
      .safeParse(request.guestName);
    if (!nameParsed.success) {
      return { ok: false, error: REISSUE_NAME_INVALID_ERROR };
    }
    correctedName = nameParsed.data;
  }
  const actorId = ctx.userId;
  // Resolved before the caller's transaction opens, so a refused bill
  // never starts one.
  const moduleEnabled = await isFeatureEnabledForTenant(
    ctx.tenantId,
    BOOKING_FEATURE_KEY,
  );

  return withTenant(ctx.tenantId, async (tx) => {
    const context = await loadBooking(tx, ctx, parsed.data, {
      forUpdate: true,
    });
    if (!context) return { ok: false, error: "Booking not found." };
    const { booking, facilityName, subUnitName, memberName } = context;

    if (booking.status === "cancelled") {
      return { ok: false, error: "Cancelled bookings cannot be billed." };
    }
    // WR-1 — the payer. A member booking names its member; a walk-in
    // booking names the guest and no member. The two are exclusive, and
    // a walk-in booking without a name cannot be billed at all: there
    // would be no buyer on the document.
    const walkInName = booking.walkInName?.trim() ?? "";
    const bookingGuestName = walkInName.length > 0 ? walkInName : null;
    if (!booking.memberId && !bookingGuestName) {
      return { ok: false, error: "This walk-in booking has no name to bill." };
    }
    const payer = booking.memberId
      ? {
          payerKind: "member" as const,
          memberId: booking.memberId,
          guestName: null as string | null,
        }
      : {
          payerKind: "guest" as const,
          memberId: null as string | null,
          guestName: bookingGuestName,
        };

    // WR-12 — a corrected buyer's name is a GUEST document's business
    // only. A member booking's buyer name comes from the member's own
    // person record (WR-2): there is no typed name to correct, and a
    // name supplied here could only ever try to re-point the payer.
    // The check comes FIRST so it holds in every state — a live bill, a
    // voided bill, a booking that was never billed.
    if (correctedName !== null && payer.payerKind !== "guest") {
      return { ok: false, error: REISSUE_NAME_MEMBER_ERROR };
    }

    // DECISION (2026-11-05) — the document the booking points at.
    //
    //   * no invoice      → the booking has never been billed;
    //   * an invoice that is not void → already billed, still
    //     collectible. This branch is deliberately above the module
    //     gate: a bill that was already issued stays collectible while
    //     the module is off;
    //   * a VOID invoice  → the document was voided, which is how the
    //     product corrects a wrongly-billed or misspelled one. The
    //     booking is issued a REPLACEMENT below — a new document, a
    //     new number, the payer taken from the booking. A replacement
    //     is a NEW issuance, so it sits BELOW the module gate.
    const linked = await loadLinkedInvoice(tx, ctx, booking);
    if (booking.invoiceId && !linked) {
      // The booking points at a document that cannot be read. The
      // foreign key says it exists, so this is not reachable in the
      // product; the inherited behaviour (refuse) is kept rather than
      // silently issuing a second document.
      return { ok: false, error: "This booking has no bill yet." };
    }
    if (linked && linked.status !== "void") {
      // A LIVE document. A corrected name cannot be applied to it —
      // the document's identity is fixed at issue (WR-7, WR-8) — so
      // the name is REFUSED, never dropped.
      if (correctedName !== null) {
        if (linked.guestName === correctedName) {
          // The intent is already satisfied: the live document carries
          // this exact buyer name. Returning it is not a silent drop —
          // the caller gets the bill that already names the buyer.
          return buildBill(
            tx,
            ctx,
            booking,
            facilityName,
            subUnitName,
            memberName,
          );
        }
        // DECISION (2026-11-05) — a PAID live invoice is kept as issued.
        // Do not send the operator to a void the product will refuse.
        if (linked.paidPaise > 0) {
          return {
            ok: false,
            error: PAID_INVOICE_CORRECTION_DEFERRED_ERROR,
          };
        }
        return { ok: false, error: REISSUE_NAME_LIVE_BILL_ERROR };
      }
      // Already issued: the bill stays collectible while the module is
      // off. This branch is deliberately above the gate.
      return buildBill(
        tx,
        ctx,
        booking,
        facilityName,
        subUnitName,
        memberName,
      );
    }
    if (!linked && correctedName !== null) {
      // NEVER BILLED. There is no voided document to replace, so there
      // is nothing to correct: the buyer's name belongs to the
      // booking, and the booking is written when the slot is taken
      // (createBooking), not by the bill request. Taking a name here
      // would be a booking edit smuggled into a billing call — and it
      // would let the bill carry a buyer the booking does not name.
      return { ok: false, error: REISSUE_NAME_ONLY_AFTER_VOID_ERROR };
    }
    if (linked && linked.paidPaise > 0) {
      return { ok: false, error: VOIDED_INVOICE_WITH_MONEY_ERROR };
    }
    // The voided predecessor, when there is one. It is kept exactly as
    // it is (the database refuses any rewrite of it) and it is named in
    // the audit row below, so the chain from the voided document to
    // its replacement is visible.
    const replacing = linked;

    const [tenantRow] = await tx
      .select({
        gstin: tenants.gstin,
        timezone: tenants.timezone,
      })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    if (!tenantRow) return { ok: false, error: "Tenant not found." };

    // F06 — no NEW booking bill while the module is off. The gate is
    // ENTITLEMENT-based and unconditional: db/features.ts resolves an
    // explicit force-off and a missing entitlement even when the tenant
    // has no plan, and fixture compatibility is not an authorization for a
    // service bypass. A REPLACEMENT is a new bill, so it is gated too.
    if (!moduleEnabled) {
      return { ok: false, error: BOOKING_MODULE_OFF_ERROR };
    }
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

    // WR-12 — the name that goes on the replacement. Without a
    // correction it is the BOOKING's name (the same name the voided
    // document carried, because that document was issued from this
    // booking). With a correction it is the corrected name, verbatim.
    // The payer KIND is untouched either way: it comes from the
    // booking, so a correction can never re-point the bill.
    const replacementGuestName =
      correctedName !== null ? correctedName : payer.guestName;

    const split = splitInclusivePrice(Number(booking.pricePaise), rateBp);
    // The guest's NAME is on the document, whichever way the payer is
    // represented: it is a fact about the booking, and it must not be
    // lost because the payer is represented differently. The description
    // is composed BOUNDED (see composeBookingLineDescription): the name
    // is kept verbatim and only the venue may be shortened, so a long
    // buyer name can never make the bill un-issuable.
    const description = composeBookingLineDescription({
      facilityName,
      subUnitName,
      timeRange: `${formatTimeIST(booking.startsAt)}–${formatTimeIST(booking.endsAt)}`,
      guestName: replacementGuestName,
    });
    if (!description) {
      return {
        ok: false,
        error:
          "This booking's details are too long to put on an invoice line.",
      };
    }
    const issuedOn = todayInZone(tenantRow.timezone);

    const issued = await issueInvoiceInTx(
      tx,
      {
        tenantId: ctx.tenantId,
        locationId: booking.locationId,
        issuedOn,
        dueOn: issuedOn,
        source: "other",
        payerKind: payer.payerKind,
        memberId: payer.memberId,
        guestName: replacementGuestName,
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

    // The booking's pointer moves to the replacement. One live invoice
    // per booking, always: the voided predecessor keeps its own row and
    // its own number, and nothing points at it any more.
    //
    // WR-12 — the booking's OWN name is NOT written here. The booking
    // row keeps the name the desk recorded when the slot was taken; the
    // corrected name lives on the document and in the audit trail. That
    // is what keeps the booking immutable (see the WR-12 header).
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
      // DECISION (2026-11-05) — the row names the document this bill
      // REPLACED, so "void, then reissue" is one legible chain: the
      // voided document's own invoice.void row says who voided it and
      // why, and this row says what replaced it.
      before: replacing
        ? {
            invoiceId: replacing.id,
            invoiceNumber: replacing.invoiceNumber,
            status: "void",
            // WR-12 — the name the VOIDED document carried. With it,
            // the from→to of a name correction is legible in ONE row:
            // before.guestName is what the customer was billed under,
            // after.guestName is what the replacement names.
            guestName: replacing.guestName,
          }
        : { invoiceId: null },
      after: {
        invoiceId: issued.invoiceId,
        invoiceNumber: issued.invoiceNumber,
        totalPaise: issued.totalPaise,
        // WR-1 — the audit row names the payer, so a guest bill is
        // traceable without reading the invoice.
        payerKind: payer.payerKind,
        guestName: replacementGuestName,
        // The replacement is explicit in the audit trail.
        replacesInvoiceNumber: replacing?.invoiceNumber ?? null,
        // WR-12 — did this replacement CORRECT the buyer's name? false
        // means the replacement carries the same name the voided
        // document carried (the plain reissue, with no correction).
        guestNameCorrected: replacing
          ? replacing.guestName !== replacementGuestName
          : false,
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
