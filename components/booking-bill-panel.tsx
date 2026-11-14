"use client";

import { useState } from "react";
import { Receipt } from "lucide-react";
import { BookingEntryPass } from "@/components/bookings/booking-entry-pass";
import { mintBookingEntryPass } from "@/components/bookings/booking-entry-actions.client";
import {
  BookingInvoiceCorrection,
  type BookingInvoiceCorrectionPhase,
} from "@/components/bookings/booking-invoice-correction";
import type {
  BookingEntryPassState,
  MintEntryPassResult,
} from "@/components/bookings/booking-entry-shared";
import { Button } from "@/components/ui/Button";
import { CafePaymentPanel } from "@/components/cafe-payment-panel";
import { formatINR } from "@/lib/money/format";
import { formatDateIST, formatTimeIST } from "@/lib/time/tz";
import {
  METHOD_OPTIONS,
  type PaymentMethod,
} from "@/components/cafe-order-shared";
import type { BookingBill } from "@/lib/services/booking-billing";
import { BillingIssuerDetails } from "@/components/billing-issuer-details";

// V-04 — the booking bill: the facility/time header, the single
// invoice line, the subtotal/GST/total maths (all integer paise,
// re-derived on the server) and the amount due. Below it sits the
// same payment panel the café uses — Request bill → amount visible →
// Collect — so the counter has one settlement flow, not two.
//
// The booking price is GST-inclusive: the total here is exactly the
// price quoted at booking time, to the paisa.
//
// WR-1 / Option A — the bill's payer line names the PAYER: the member
// for a member booking, the walk-in's own name for a walk-in booking.
// This line is unchanged by the entry-pass correction.
//
// Entry pass (2026-11-06, v3): the receipt renders only a view the
// server action supplied. It has no bill-derived fallback. A ready
// view is rendered only when BOTH `bookingId` and `invoiceId` match
// this receipt; a view for a replaced document or another booking is
// treated as unavailable. The money badge follows the authoritative
// `paymentState`, while the total/method line is labelled as the
// settlement that was recorded. A loading, failed or mismatched read
// never says "Paid" and never offers a pass.

export function BookingBillPanel({
  bill,
  onPaid,
  onBack,
  canCorrectInvoice = false,
  onBillReplaced,
}: {
  bill: BookingBill;
  onPaid: (method: PaymentMethod, billId?: string) => void;
  onBack: () => void;
  /**
   * Whether the desk may correct an unpaid walk-in invoice.
   *
   * The page server decides this from the owner's management authority
   * (`settings.manage`) — the same authority voidInvoiceAction checks
   * on the server. It is an affordance gate only, and it FAILS CLOSED:
   * without the flag there is no correction control at all.
   */
  canCorrectInvoice?: boolean;
  /**
   * The replacement document, handed back by the correction. The
   * container swaps the bill on screen for it.
   */
  onBillReplaced?: (bill: BookingBill) => void;
}) {
  const [correctionPhase, setCorrectionPhase] =
    useState<BookingInvoiceCorrectionPhase>("idle");

  const voided = bill.invoiceStatus === "void";
  const correctionAllowed =
    canCorrectInvoice &&
    bill.memberId === null &&
    (bill.invoiceStatus === "void" ||
      (bill.invoiceStatus === "issued" && bill.amountDuePaise === bill.totalPaise));
  const collecting = !voided && correctionPhase === "idle";

  return (
    <section
      className="rounded-card border border-line bg-paper p-4 space-y-4"
      data-testid="booking-bill"
      data-amount-due={bill.amountDuePaise}
    >
      <BillingIssuerDetails issuer={bill.issuer} />
      <div>
        <p className="text-[12px] text-ink-3">
          Bill for {bill.payerName || "guest"}
          {bill.documentKind === "bill_of_supply" ? " · Bill of Supply" : ""}
        </p>
        <p className="font-display text-[18px] font-semibold text-ink">
          {bill.invoiceNumber}
        </p>
        <p className="mt-1 text-[13px] text-ink-2">
          {bill.facilityName}
          {bill.subUnitName ? ` · ${bill.subUnitName}` : ""}
        </p>
        <p className="text-[12px] text-ink-3">
          {formatDateIST(bill.startsAt)} · {formatTimeIST(bill.startsAt)}–
          {formatTimeIST(bill.endsAt)}
        </p>
      </div>

      <ul className="divide-y divide-line" data-testid="booking-bill-lines">
        <li className="flex items-start justify-between gap-3 py-2">
          <span className="min-w-0 text-[14px] text-ink">
            {bill.lineDescription}
          </span>
          <span className="text-[14px] font-medium text-ink">
            {formatINR(bill.subtotalPaise + bill.taxPaise)}
          </span>
        </li>
      </ul>

      <div className="border-t border-line pt-3 space-y-1">
        <div className="flex justify-between text-[13px] text-ink-2">
          <span>Subtotal</span>
          <span data-testid="booking-bill-subtotal">
            {formatINR(bill.subtotalPaise)}
          </span>
        </div>
        <div className="flex justify-between text-[13px] text-ink-2">
          <span>GST</span>
          <span data-testid="booking-bill-tax">{formatINR(bill.taxPaise)}</span>
        </div>
        <div className="flex justify-between text-[15px] font-semibold text-ink">
          <span>Total</span>
          <span data-testid="booking-bill-total">
            {formatINR(bill.totalPaise)}
          </span>
        </div>
        <div
          className="flex justify-between text-[15px] font-semibold text-ink"
          data-testid="booking-amount-due"
          data-amount-paise={bill.amountDuePaise}
        >
          <span>Amount due</span>
          <span>{formatINR(bill.amountDuePaise)}</span>
        </div>
      </div>

      {correctionAllowed ? (
        <BookingInvoiceCorrection
          bill={bill}
          onBillReplaced={onBillReplaced}
          onPhaseChange={setCorrectionPhase}
        />
      ) : null}

      {voided ? (
        <p
          role="status"
          className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2"
          data-testid="booking-bill-void"
        >
          This invoice is void, so there is nothing to collect on it.
        </p>
      ) : !collecting ? null : bill.amountDuePaise > 0 ? (
        <CafePaymentPanel bill={bill} onPaid={onPaid} />
      ) : (
        <p className="rounded-ctl bg-good-soft px-3 py-2 text-[13px] text-ink">
          This bill is settled in full.
        </p>
      )}

      <Button variant="ghost" size="sm" className="w-full" onClick={onBack}>
        Back to the board
      </Button>
    </section>
  );
}

type ReceiptMoneyState = "paid" | "partial" | "unpaid" | "refunded" | null;

function moneyLabel(state: ReceiptMoneyState): string {
  switch (state) {
    case "paid":
      return "Paid";
    case "partial":
      return "Partly paid";
    case "unpaid":
      return "Not paid";
    case "refunded":
      return "Refunded";
    default:
      // No matching authoritative view yet. The receipt may describe the
      // settlement it recorded, but it must not claim the current invoice is
      // paid.
      return "Settlement recorded";
  }
}

export function BookingReceipt({
  bill,
  method,
  onReset,
  entryPass,
  onMintPass,
}: {
  bill: BookingBill;
  /**
   * The method used for a payment just recorded. Null when an already-settled
   * bill is reopened: `BookingBill` does not carry the original method, and
   * inventing one would be a false settlement fact.
   */
  method: PaymentMethod | null;
  onReset: () => void;
  /**
   * The server-resolved pass state.
   *
   * `ready` carries the view produced by
   * `readBookingEntryPassViewAction` after its `bookings.read` check.
   * `loading` and `error` are honest states. An absent value is treated
   * as unavailable, NEVER as a confirmed, authorised, not-checked-in
   * booking: a settled invoice proves none of those facts.
   */
  entryPass?: BookingEntryPassState;
  /**
   * The real mint action, injected by the container. The default calls
   * the Server Action adapter; the mint action checks `bookings.read`
   * and the booking's eligibility again.
   */
  onMintPass?: (bookingId: string) => Promise<MintEntryPassResult>;
}) {
  const methodLabel = method
    ? METHOD_OPTIONS.find((option) => option.value === method)?.label ?? method
    : null;
  const mint = onMintPass ?? mintBookingEntryPass;

  // The view must be for this bill's booking AND this bill's invoice. A
  // mismatched, replaced or absent view is unavailable; it is never rendered
  // against another document's money facts.
  const ready =
    entryPass?.state === "ready" &&
    entryPass.view.bookingId === bill.bookingId &&
    entryPass.view.invoiceId === bill.invoiceId
      ? entryPass.view
      : null;
  const moneyState: ReceiptMoneyState = ready?.paymentState ?? null;
  const moneyTone =
    moneyState === "paid" ? "text-good" : "text-ink-2";

  const holdingState: "loading" | "error" | "missing" | "mismatch" =
    entryPass?.state === "loading"
      ? "loading"
      : entryPass?.state === "error"
        ? "error"
        : entryPass?.state === "ready"
          ? "mismatch"
          : "missing";

  return (
    <section
      className="rounded-card border border-line bg-paper p-5"
      data-testid="booking-receipt"
    >
      <div className={`flex items-center gap-2 ${moneyTone}`}>
        <Receipt size={18} strokeWidth={2} />
        <p
          className="text-[14px] font-semibold"
          data-testid="booking-receipt-money-state"
          data-payment-state={moneyState ?? "unconfirmed"}
        >
          {moneyLabel(moneyState)}
        </p>
      </div>
      <p className="mt-2 font-display text-[20px] font-semibold text-ink">
        {bill.invoiceNumber}
      </p>
      <p
        className="mt-1 text-[13px] text-ink-2"
        data-testid="booking-receipt-settlement"
      >
        Recorded at settlement: {formatINR(bill.totalPaise)}
        {methodLabel ? ` · ${methodLabel}` : ""}
      </p>

      <div className="mt-4 border-t border-line pt-4">
        {ready ? (
          <BookingEntryPass
            booking={ready}
            onMintPass={() => mint(ready.bookingId)}
          />
        ) : (
          <EntryPassUnavailable state={holdingState} />
        )}
      </div>

      <Button
        variant="secondary"
        size="md"
        className="mt-4 w-full"
        onClick={onReset}
      >
        New booking
      </Button>
    </section>
  );
}

/**
 * The receipt's honest holding state.
 *
 * It deliberately offers no pass control. The wording says what happened:
 * the view is being checked, the read failed, no view was provided, or the
 * view belonged to a different document. It never says the booking is
 * confirmed, unauthorised or not checked in, because none of those facts is
 * known here.
 */
function EntryPassUnavailable({
  state,
}: {
  state: "loading" | "error" | "missing" | "mismatch";
}) {
  return (
    <section
      data-testid="booking-entry-pass-unavailable"
      aria-labelledby="booking-entry-pass-unavailable-heading"
      className="rounded-card border border-line bg-deck p-4"
    >
      <h2
        id="booking-entry-pass-unavailable-heading"
        className="font-display text-[16px] font-semibold text-ink"
      >
        Entry pass
      </h2>
      <p
        role={
          state === "loading"
            ? "status"
            : state === "error"
              ? "alert"
              : undefined
        }
        className="mt-2 text-[13px] text-ink-2"
      >
        {state === "loading"
          ? "Checking entry pass availability…"
          : state === "error"
            ? "Entry pass availability could not be checked. Reload and try again."
            : state === "mismatch"
              ? "Entry pass availability could not be confirmed for this bill. Reload the receipt."
              : "Entry pass availability was not provided. Reload the booking receipt."}
      </p>
    </section>
  );
}
