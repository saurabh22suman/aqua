"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FieldError } from "@/components/ui/FieldError";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { getInvoiceAction, voidInvoiceAction } from "@/lib/actions/invoices";
import { readBookingBillAction, requestBookingBillAction } from "@/lib/actions/bookings";
import type { BookingBill, BookingBillResult } from "@/lib/services/booking-billing";


export type BookingInvoiceCorrectionPhase =
  | "idle" | "editing" | "working" | "pending"
  | "uncertain" | "deferred" | "mismatch" | "replaced";

const NAME_MAX = 120;
const REASON_MIN = 3;
const REASON_MAX = 300;

export function BookingInvoiceCorrection({
  bill,
  onBillReplaced,
  onPhaseChange,
}: {
  bill: BookingBill;
  /** The replacement document, for the container that owns the bill. */
  onBillReplaced?: (bill: BookingBill) => void;
  /** The phase, so the container can hold back the payment panel. */
  onPhaseChange?: (phase: BookingInvoiceCorrectionPhase) => void;
}) {
  const [phase, setPhase] = useState<BookingInvoiceCorrectionPhase>("idle");
  const [guestName, setGuestName] = useState("");
  const [reason, setReason] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "status" | "alert"; text: string } | null>(null);
  const [intentName, setIntentName] = useState<string | null>(null);
  const alreadyVoid = bill.invoiceStatus === "void";

  function move(next: BookingInvoiceCorrectionPhase) {
    setPhase(next);
    onPhaseChange?.(next);
  }

  function say(tone: "status" | "alert", text: string) {
    setNotice({ tone, text });
  }

  function open() {
    setNameError(null);
    setReasonError(null);
    setNotice(null);
    move("editing");
  }

  function cancelBeforeVoid() {
    setGuestName("");
    setReason("");
    setNameError(null);
    setReasonError(null);
    setNotice(null);
    setIntentName(null);
    move("idle");
  }

  async function readCurrentBill(): Promise<BookingBill | null> {
    const result = await readBookingBillAction({ bookingId: bill.bookingId }).catch(() => null);
    return result && result.ok ? result.bill : null;
  }

  async function submit() {
    const trimmedName = guestName.trim();
    const trimmedReason = reason.trim();
    const nameOk = trimmedName.length >= 1 && trimmedName.length <= NAME_MAX;
    const reasonOk = alreadyVoid || (trimmedReason.length >= REASON_MIN && trimmedReason.length <= REASON_MAX);
    setNameError(nameOk ? null : "Enter the guest name (1-120 characters).");
    setReasonError(reasonOk ? null : "Give a reason (3-300 characters).");
    if (!nameOk || !reasonOk) return;

    setIntentName(trimmedName);
    if (alreadyVoid) {
      await issueReplacement(trimmedName, true);
      return;
    }
    say("status", "Voiding the original invoice…");
    move("working");

    let voided = false;
    try {
      voided = (await voidInvoiceAction({ invoiceId: bill.invoiceId, reason: trimmedReason })).ok;
    } catch {
      voided = false;
    }
    if (voided) {
      await issueReplacement(trimmedName, true);
      return;
    }
    await reconcileVoid(trimmedName);
  }

  async function reconcileVoid(name: string) {
    move("working");
    const invoice = await getInvoiceAction(bill.invoiceId).catch(() => null);
    if (!invoice) {
      say("alert", "The original invoice could not be read, so it is not known whether it was voided. Check the invoice status before trying again.");
      move("uncertain");
      return;
    }
    if (invoice.paidPaise > 0) {
      say("alert", "This invoice is already paid, so it stays as issued. Paid corrections are deferred for this release; ask an owner to review it.");
      move("deferred");
      const current = await readCurrentBill();
      if (current) onBillReplaced?.(current);
      return;
    }
    if (invoice.status === "void") {
      await issueReplacement(name, true);
      return;
    }
    setIntentName(null);
    say("alert", "The invoice was not voided. Check the reason and try again.");
    move("editing");
  }

  async function issueReplacement(name: string, first: boolean) {
    move("working");
    say("status", first
      ? `Invoice ${bill.invoiceNumber} is void. Issuing the replacement invoice…`
      : `Invoice ${bill.invoiceNumber} is void. Retrying the replacement invoice…`);
    let result: BookingBillResult;
    try {
      result = await requestBookingBillAction({ bookingId: bill.bookingId, guestName: name });
    } catch {
      result = { ok: false, error: "The request did not complete." };
    }
    if (result.ok) {
      say("status", `Replacement invoice ${result.bill.invoiceNumber} has been issued for ${result.bill.payerName || "the guest"}.`);
      onBillReplaced?.(result.bill);
      move("replaced");
      return;
    }
    say("alert", `Invoice ${bill.invoiceNumber} is void. No replacement was confirmed: ${result.error}`);
    move("pending");
    await reconcileReplacement(name);
  }

  async function reconcileReplacement(name: string) {
    const current = await readCurrentBill();
    if (!current) {
      return;
    }
    if (current.invoiceId === bill.invoiceId) return; // still the voided original
    if (current.payerName.trim() === name.trim()) {
      onBillReplaced?.(current);
      say("status", `Invoice ${current.invoiceNumber} now carries the corrected guest name.`);
      return;
    }
    say("alert", `Another invoice now covers this booking: ${current.invoiceNumber}, issued to ${current.payerName || "the guest"} (${current.invoiceStatus}). The corrected name was not applied, and that invoice was not voided.`);
    move("mismatch");
  }

  async function retryReplacement() {
    if (intentName === null) return;
    setNotice(null);
    await issueReplacement(intentName, false);
  }

  async function checkStatus() {
    if (intentName === null) return;
    setNotice(null);
    await reconcileVoid(intentName);
  }

  if (phase === "idle") {
    return (
      <section
        className="rounded-card border border-line bg-deck p-4"
        data-testid="booking-invoice-correction"
      >
        <p className="text-[13px] text-ink-2">
          {alreadyVoid
            ? "This invoice is void. Issue a replacement with the correct guest name before collecting payment."
            : "This invoice has not been paid. If the guest name on it is wrong, it can be voided and reissued with the correct name."}
        </p>
        <Button variant="secondary" size="md" className="mt-3 w-full" onClick={open}>
          {alreadyVoid ? "Reissue voided invoice" : "Correct unpaid invoice"}
        </Button>
      </section>
    );
  }

  return (
    <section
      className="rounded-card border border-line bg-deck p-4 space-y-3"
      data-testid="booking-invoice-correction" data-phase={phase}
    >
      <h3 className="font-display text-[15px] font-semibold text-ink">
        Correct this invoice
      </h3>

      {notice ? (
        <p role={notice.tone === "alert" ? "alert" : "status"}
          className="rounded-ctl border border-line bg-paper px-3 py-2 text-[13px] text-ink-2">
          {notice.text}
        </p>
      ) : null}

      {phase === "editing" ? (
        <div className="space-y-3">
          <div>
            <Label htmlFor="booking-correction-guest-name">Corrected guest name</Label>
            <Input id="booking-correction-guest-name" className="mt-1" value={guestName}
              maxLength={NAME_MAX} aria-required="true" invalid={nameError !== null}
              onChange={(event) => setGuestName(event.target.value)} />
            <FieldError>{nameError}</FieldError>
          </div>
          {!alreadyVoid ? <div>
            <Label htmlFor="booking-correction-reason">Reason for correction</Label>
            <Input id="booking-correction-reason" className="mt-1" value={reason}
              maxLength={REASON_MAX} aria-required="true" invalid={reasonError !== null}
              onChange={(event) => setReason(event.target.value)} />
            <FieldError>{reasonError}</FieldError>
          </div> : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="primary" size="md" className="sm:flex-1" onClick={() => void submit()}>
              {alreadyVoid ? "Issue replacement" : "Void and reissue"}
            </Button>
            <Button variant="ghost" size="md" onClick={cancelBeforeVoid}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {phase !== "editing" && intentName !== null ? (
        <p className="text-[13px] text-ink-2">
          Corrected guest name:{" "}
          <span className="font-medium text-ink">{intentName}</span>
        </p>
      ) : null}

      {phase === "pending" ? (
        <Button variant="primary" size="md" className="w-full" onClick={() => void retryReplacement()}>
          Retry reissue
        </Button>
      ) : null}

      {phase === "uncertain" ? (
        <Button variant="secondary" size="md" className="w-full" onClick={() => void checkStatus()}>
          Check invoice status
        </Button>
      ) : null}
    </section>
  );
}
