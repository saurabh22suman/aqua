"use client";

import { useEffect, useRef, useState } from "react";
import { recordPaymentAction } from "@/lib/actions/payments";
import {
  cancelPaymentRecoveryAction,
  listPaymentRecoveryAction,
} from "@/lib/actions/payment-intents";
import {
  inputClass,
  METHOD_OPTIONS,
  REFERENCE_LABEL,
  type BillSummary,
  type PaymentMethod,
} from "@/components/cafe-order-shared";
import { Button } from "@/components/ui/Button";
import { PaymentRecoveryNotice } from "@/components/payment-recovery-notice";
import { BillUpiQr } from "@/components/payments/bill-upi-qr";
import { recoveryQrBlockedReason } from "@/components/payments/recovery-qr-gate";
import { usePaymentRecovery } from "@/components/use-payment-recovery";
import {
  AMBIGUOUS_RECOVERY_BLOCKED,
  ambiguousRecoveryMessage,
} from "@/components/payment-recovery-copy";
import { mintPaymentKey } from "@/lib/payment-key";

const AMBIGUOUS_PAYMENT = ambiguousRecoveryMessage("payment", "bill");

export function CafePaymentRecoveryForm({
  bill,
  onPaid,
}: {
  bill: BillSummary;
  onPaid: (method: PaymentMethod, billId?: string) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // F01 — the server owns recovery; this ref is only the page's cache.
  const attempt = useRef<{ targetId: string; key: string } | null>(null);
  const [retryLast, setRetryLast] = useState(false);
  const [newConfirmed, setNewConfirmed] = useState(false);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  // The bill this form is currently showing. A request that was sent for
  // another bill must never mark, block or fail THIS bill.
  const billIdRef = useRef(bill.invoiceId);
  const {
    recovery,
    ready,
    checking,
    checkError,
    cancelError,
    cancel,
    refresh: refreshRecovery,
  } = usePaymentRecovery(
    bill.invoiceId,
    listPaymentRecoveryAction,
    cancelPaymentRecoveryAction,
  );

  const referenceMissing = method !== "cash" && reference.trim().length === 0;

  useEffect(() => {
    // A different bill is a different operation: the retained unknown
    // outcome, the page-local attempt key and the bill-specific reference
    // belong to the previous bill and must not follow the operator.
    billIdRef.current = bill.invoiceId;
    setRetryLast(false);
    setNewConfirmed(false);
    setOutcomeUnknown(false);
    attempt.current = null;
    setError(null);
    setReference("");
  }, [bill.invoiceId]);

  async function submit() {
    if (!ready) {
      setError("Check for an earlier attempt on this bill before recording.");
      return;
    }
    if (!recovery.open && recovery.ambiguous) {
      setError(AMBIGUOUS_PAYMENT);
      return;
    }
    const last = recovery.lastCommitted;
    const stored =
      attempt.current?.targetId === bill.invoiceId
        ? attempt.current.key
        : null;
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
      key = stored ?? mintPaymentKey();
    }
    if (!key) {
      setError(
        "This browser cannot create a secure one-time key. Use a current browser and try again.",
      );
      return;
    }
    const observedIntentId = last?.intentId ?? null;
    const submittedBillId = bill.invoiceId;
    attempt.current = { targetId: bill.invoiceId, key };
    setBusy(true);
    setError(null);
    try {
      const result = await recordPaymentAction({
        invoiceId: bill.invoiceId,
        amountPaise: bill.amountDuePaise,
        method,
        ...(method === "cash" ? {} : { reference: reference.trim() }),
        idempotencyKey: key,
        observedIntentId,
      });
      if (billIdRef.current !== submittedBillId) {
        // The operator moved to another bill while this request was in
        // flight. This bill's outcome must not touch the current bill; the
        // recorded payment stays on the server for the bill it belongs to.
        if (result.ok) onPaid(method, submittedBillId);
        return;
      }
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
      onPaid(method, submittedBillId);
      void refreshRecovery();
    } catch {
      setOutcomeUnknown(true);
      setError(
        "The request did not complete. It may already have been recorded — check the bill before recording another payment.",
      );
      void refreshRecovery();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
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
          className="rounded-ctl border border-line bg-warn-soft px-3 py-2 text-[13px] text-ink"
          data-testid="cafe-payment-error"
        >
          {error}
        </p>
      ) : null}

      <div>
        <p className="block text-[12px] font-medium text-ink-2 mb-2">
          Payment method
        </p>
        <div className="grid grid-cols-2 gap-2">
          {METHOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={method === option.value}
              onClick={() => {
                setMethod(option.value);
                setReference("");
              }}
              className={`min-h-[44px] rounded-ctl border px-3 py-2 text-left ${
                method === option.value
                  ? "border-[var(--accent-strong)] bg-paper"
                  : "border-line bg-paper"
              }`}
            >
              <span className="block text-[13px] font-medium text-ink">
                {option.label}
              </span>
              <span className="block text-[11px] text-ink-3">
                {option.hint}
              </span>
            </button>
          ))}
        </div>
      </div>

      {method !== "cash" ? (
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            {REFERENCE_LABEL[method]}
          </span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className={inputClass}
            data-testid="cafe-reference"
          />
        </label>
      ) : null}

      {method === "upi" ? (
        <BillUpiQr
          invoiceId={bill.invoiceId}
          invoiceNumber={bill.invoiceNumber}
          amountPaise={BigInt(bill.amountDuePaise)}
          outstandingPaise={BigInt(bill.amountDuePaise)}
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
        variant="primary"
        size="lg"
        className="w-full"
        onClick={submit}
        disabled={
          busy ||
          referenceMissing ||
          !ready ||
          (!recovery.open && recovery.ambiguous === true) ||
          (!recovery.open &&
            recovery.lastCommitted !== null &&
            !retryLast &&
            !newConfirmed)
        }
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
    </>
  );
}
