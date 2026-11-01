"use client";

import { useEffect, useRef, useState } from "react";
import { recordPaymentAction } from "@/lib/actions/payments";
import {
  cancelPaymentRecoveryAction,
  listPaymentRecoveryAction,
} from "@/lib/actions/payment-intents";
import { parseRupeesToPaise } from "@/lib/payment-qr";
import type { InvoiceRow } from "@/lib/services/invoices";
import { METHOD_LABEL, type PaymentMethodKey } from "@/lib/money/payment-groups";
import { PaymentMethodFields } from "@/components/reception/payment-method-fields";
import { Button } from "@/components/ui/Button";
import { PaymentAmountField } from "@/components/payments/payment-amount-field";
import { PaymentRecoveryNotice } from "@/components/payment-recovery-notice";
import { BillUpiQr } from "@/components/payments/bill-upi-qr";
import { recoveryQrBlockedReason } from "@/components/payments/recovery-qr-gate";
import { usePaymentRecovery } from "@/components/use-payment-recovery";
import {
  AMBIGUOUS_RECOVERY_BLOCKED,
  ambiguousRecoveryMessage,
} from "@/components/payment-recovery-copy";
import { mintPaymentKey } from "@/lib/payment-key";

const AMBIGUOUS_PAYMENT = ambiguousRecoveryMessage("payment", "invoice");

/**
 * The selected-invoice half of the reception counter. `onRecorded` refreshes
 * the parent's list and returns the next outstanding amount (null = none open,
 * undefined = refresh failed).
 */
export function PaymentRecordRecoveryForm({
  invoice,
  onRecorded,
  searchBusy = false,
  onBusyChange,
  onMessage,
}: {
  invoice: InvoiceRow;
  onRecorded: () => Promise<number | null | undefined>;
  searchBusy?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onMessage?: (message: string | null) => void;
}) {
  const [amountText, setAmountText] = useState(
    invoice.outstandingPaise > 0
      ? (invoice.outstandingPaise / 100).toFixed(2)
      : "",
  );
  const [method, setMethod] = useState<PaymentMethodKey>("cash");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const attempt = useRef<{ targetId: string; key: string } | null>(null);
  const [retryLast, setRetryLast] = useState(false);
  const [newConfirmed, setNewConfirmed] = useState(false);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const {
    recovery,
    ready,
    checking,
    checkError,
    cancelError,
    cancel,
    refresh: refreshRecovery,
  } = usePaymentRecovery(
    invoice.id,
    listPaymentRecoveryAction,
    cancelPaymentRecoveryAction,
  );
  useEffect(() => {
    setRetryLast(false);
    setNewConfirmed(false);
  }, [invoice.id]);
  const amountPaise = parseRupeesToPaise(amountText);
  function submit() {
    if (!ready) {
      setError(
        "Check for an earlier attempt on this invoice before recording.",
      );
      return;
    }
    if (!recovery.open && recovery.ambiguous) {
      setError(AMBIGUOUS_PAYMENT);
      return;
    }
    if (amountPaise === null || amountPaise <= 0n) {
      setError("Enter an amount like 2500 or 2500.50.");
      return;
    }
    if (method !== "cash" && reference.trim().length === 0) {
      setError(`A ${METHOD_LABEL[method].toLowerCase()} payment needs its reference.`);
      return;
    }
    const last = recovery.lastCommitted;
    // Explicit choice: open/retry continue the same attempt; a separate
    // payment needs the operator's confirmation.
    const stored =
      attempt.current?.targetId === invoice.id ? attempt.current.key : null;
    let key: string | null;
    if (recovery.open) {
      key = recovery.open.idempotencyKey;
    } else if (retryLast && last) {
      key = last.idempotencyKey;
    } else if (last) {
      if (!newConfirmed) {
        setError(
          "Choose “Retry the same payment” or confirm “Record a separate payment” in the recovery notice.",
        );
        return;
      }
      key = mintPaymentKey();
    } else {
      // A page-local retry whose outcome is still unknown.
      key = stored ?? mintPaymentKey();
    }
    if (!key) {
      setError(
        "This browser cannot create a secure one-time key. Use a current browser and try again.",
      );
      return;
    }
    const observedIntentId = last?.intentId ?? null;
    attempt.current = { targetId: invoice.id, key };
    setBusy(true);
    onBusyChange?.(true);
    setError(null);
    setMessage(null);
    onMessage?.(null);
    void (async () => {
      try {
        const result = await recordPaymentAction({
          invoiceId: invoice.id,
          amountPaise: Number(amountPaise),
          method,
          ...(method === "cash" ? {} : { reference: reference.trim() }),
          idempotencyKey: key,
          observedIntentId,
        });
        if (!result.ok) {
          if (
            result.conflict === "cancelled" ||
            result.conflict === "already_recorded" ||
            result.conflict === "stale_observation"
          ) {
            attempt.current = null;
            setRetryLast(false);
            setNewConfirmed(false);
          }
          // Feedback is immediate; the re-read only refines the copy.
          setError(result.error);
          void refreshRecovery().then((refreshed) => {
            if (result.conflict === "stale_observation" && refreshed?.ambiguous) {
              setError(AMBIGUOUS_RECOVERY_BLOCKED);
            }
          });
          return;
        }
        attempt.current = null;
        setOutcomeUnknown(false);
        setRetryLast(false);
        setNewConfirmed(false);
        const nextMessage =
          result.replayed
            ? "This payment was already recorded; the invoice's current status has been refreshed."
            : result.invoiceStatus === "paid"
              ? "Payment recorded. Invoice is now paid."
              : result.invoiceStatus === "partial"
                ? "Payment recorded. Invoice is now partially paid."
                : "Payment recorded. The invoice's current status has been refreshed.";
        setMessage(nextMessage);
        onMessage?.(nextMessage);
        // A list-refresh failure must not be reported as unknown payment.
        const nextOutstanding = await onRecorded();
        if (nextOutstanding === null) {
          setAmountText("");
        } else if (typeof nextOutstanding === "number") {
          setAmountText((nextOutstanding / 100).toFixed(2));
        }
        setReference("");
        void refreshRecovery();
      } catch {
        // UNKNOWN OUTCOME: keep the page key and re-read the server.
        setOutcomeUnknown(true);
        const unknown =
          "The request did not complete. It may already have been recorded — check the invoice before recording another payment.";
        setError(unknown);
        onMessage?.(unknown);
        void refreshRecovery();
      } finally {
        setBusy(false);
        onBusyChange?.(false);
      }
    })();
  }

  return (
    <div className="space-y-3 border-t border-line pt-3">
      <PaymentAmountField
        id="payment-amount"
        value={amountText}
        onChange={setAmountText}
        testId="payment-amount"
      />
      <PaymentMethodFields
        method={method}
        setMethod={setMethod}
        reference={reference}
        setReference={setReference}
      />
      {method === "upi" ? (
        <BillUpiQr
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoiceNumber}
          amountPaise={amountPaise}
          outstandingPaise={BigInt(invoice.outstandingPaise)}
          blockedReason={recoveryQrBlockedReason({
            busy,
            outcomeUnknown,
            ready,
            recovery,
            newConfirmed,
          })}
        />
      ) : null}
      <Button
        type="button"
        variant="primary"
        onClick={submit}
        disabled={
          busy ||
          searchBusy ||
          !ready ||
          (!recovery.open && recovery.ambiguous === true) ||
          (!recovery.open &&
            recovery.lastCommitted !== null &&
            !retryLast &&
            !newConfirmed)
        }
        className="w-full"
      >
        {busy
          ? "Recording…"
          : recovery.open
            ? "Continue earlier attempt"
            : retryLast
              ? "Retry the same payment"
              : newConfirmed
                ? "Record a separate payment"
                : recovery.lastCommitted
                  ? "Choose a recovery option first"
                  : "Record payment"}
      </Button>
      <PaymentRecoveryNotice
        recovery={recovery}
        checking={checking}
        checkError={checkError}
        cancelError={cancelError}
        retryLast={retryLast}
        newConfirmed={newConfirmed}
        ambiguousMessage={AMBIGUOUS_PAYMENT}
        onRetryCheck={() => void refreshRecovery()}
        onCancel={() => {
          void (async () => {
            if (await cancel()) {
              attempt.current = null;
              setOutcomeUnknown(false);
              setRetryLast(false);
              setNewConfirmed(false);
            }
          })();
        }}
        onRetryLast={() => {
          setRetryLast(true);
          setNewConfirmed(false);
        }}
        onRecordNew={() => {
          setNewConfirmed(true);
          setRetryLast(false);
          attempt.current = null;
        }}
      />
      {error ? (
        <p
          role="alert"
          className="rounded-ctl border border-line bg-deck px-3 py-2 text-[12.5px] text-ink-2"
        >
          {error}
        </p>
      ) : null}
      {!onMessage && message ? (
        <p role="status" className="text-[12.5px] text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}
