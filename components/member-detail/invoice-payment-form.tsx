"use client";

import { useEffect, useRef, useState } from "react";
import { recordPaymentAction } from "@/lib/actions/payments";
import {
  cancelPaymentRecoveryAction,
  listPaymentRecoveryAction,
} from "@/lib/actions/payment-intents";
import { parseRupeesToPaise } from "@/lib/payment-qr";
import type { PaymentRow } from "@/lib/services/payments";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PaymentAmountField } from "@/components/payments/payment-amount-field";
import { Select } from "@/components/ui/Select";
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

export function InvoicePaymentForm({
  invoiceId,
  invoiceNumber,
  outstandingPaise,
  busy,
  setMessage,
  run,
}: {
  invoiceId: string;
  invoiceNumber: string;
  outstandingPaise: number;
  busy: boolean;
  setMessage: (message: string | null) => void;
  run: (
    fn: () => Promise<
      { ok: true } | { ok: false; error: string; conflict?: string }
    >,
    onResult?: (
      result: { ok: true } | { ok: false; error: string; conflict?: string },
    ) => Promise<string | void> | string | void,
  ) => void;
}) {
  const [amount, setAmount] = useState(
    outstandingPaise > 0 ? String(outstandingPaise / 100) : "",
  );
  const [method, setMethod] = useState<PaymentRow["method"]>("cash");
  const [reference, setReference] = useState("");
  const [paymentRetryLast, setPaymentRetryLast] = useState(false);
  const [paymentNewConfirmed, setPaymentNewConfirmed] = useState(false);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const paymentAttempt = useRef<{ targetId: string; key: string } | null>(null);
  const invoiceRef = useRef(invoiceId);
  const paymentRecovery = usePaymentRecovery(
    invoiceId,
    listPaymentRecoveryAction,
    cancelPaymentRecoveryAction,
  );

  useEffect(() => {
    invoiceRef.current = invoiceId;
    paymentAttempt.current = null;
    setOutcomeUnknown(false);
    setPaymentRetryLast(false);
    setPaymentNewConfirmed(false);
    setReference("");
    setMessage(null);
  }, [invoiceId, setMessage]);

  useEffect(() => {
    setAmount(outstandingPaise > 0 ? String(outstandingPaise / 100) : "");
  }, [outstandingPaise]);

  return (
    <div className="mt-2 rounded-ctl border border-line p-3">
      <p className="text-[12px] font-medium text-ink-2">Record a payment</p>
      {/* Owner redesign (C2) — the shared labelled controls, so the
          collection decision uses the same metrics and association as the
          rest of the owner surface. The invoice context (total, paid,
          outstanding) stays directly above it. */}
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <PaymentAmountField
          id="invoice-payment-amount"
          value={amount}
          onChange={setAmount}
        />
        <Field id="invoice-payment-method" label="Method">
          {(field) => (
            <Select
              {...field}
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentRow["method"])}
            >
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="card">Card terminal</option>
              <option value="other">Other</option>
            </Select>
          )}
        </Field>
        {method !== "cash" ? (
          <Field
            id="invoice-payment-reference"
            label={
              method === "card"
                ? "Card terminal reference"
                : method === "bank_transfer"
                  ? "Bank transfer reference"
                  : method === "other"
                    ? "Payment reference"
                    : "Reference (UTR)"
            }
          >
            {(field) => (
              <Input
                {...field}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="UTR / transaction id"
              />
            )}
          </Field>
        ) : null}
      </div>
      {method === "upi" ? (
        <BillUpiQr
          invoiceId={invoiceId}
          invoiceNumber={invoiceNumber}
          amountPaise={parseRupeesToPaise(amount)}
          outstandingPaise={BigInt(outstandingPaise)}
          blockedReason={recoveryQrBlockedReason({
            busy,
            outcomeUnknown,
            ready: paymentRecovery.ready,
            recovery: paymentRecovery.recovery,
            newConfirmed: paymentNewConfirmed,
          })}
        />
      ) : null}
      <Button
        type="button"
        variant="primary"
        size="md"
        disabled={
          busy ||
          !paymentRecovery.ready ||
          (!paymentRecovery.recovery.open &&
            paymentRecovery.recovery.ambiguous === true) ||
          (!paymentRecovery.recovery.open &&
            paymentRecovery.recovery.lastCommitted !== null &&
            !paymentRetryLast &&
            !paymentNewConfirmed)
        }
        onClick={() => {
          const paise = parseRupeesToPaise(amount);
          if (paise === null) {
            setMessage("Enter the amount in rupees, like 2500 or 2500.00.");
            return;
          }
          if (!paymentRecovery.ready) {
            setMessage(
              "Check for an earlier attempt on this invoice before recording.",
            );
            return;
          }
          if (
            !paymentRecovery.recovery.open &&
            paymentRecovery.recovery.ambiguous
          ) {
            setMessage(AMBIGUOUS_PAYMENT);
            return;
          }
          const last = paymentRecovery.recovery.lastCommitted;
          const stored =
            paymentAttempt.current?.targetId === invoiceId
              ? paymentAttempt.current.key
              : null;
          let key: string | null;
          if (paymentRecovery.recovery.open) {
            key = paymentRecovery.recovery.open.idempotencyKey;
          } else if (paymentRetryLast && last) {
            key = last.idempotencyKey;
          } else if (last) {
            if (!paymentNewConfirmed) {
              setMessage(
                "Choose “Retry the same payment” or confirm “Record a separate payment” in the recovery notice.",
              );
              return;
            }
            key = mintPaymentKey();
          } else {
            key = stored ?? mintPaymentKey();
          }
          if (!key) {
            setMessage(
              "This browser cannot create a secure one-time key. Use a current browser and try again.",
            );
            return;
          }
          const observedIntentId = last?.intentId ?? null;
          paymentAttempt.current = { targetId: invoiceId, key };
          run(
            () =>
              recordPaymentAction({
                invoiceId,
                amountPaise: Number(paise),
                method,
                ...(method === "cash" ? {} : { reference: reference.trim() }),
                idempotencyKey: key,
                observedIntentId,
              }),
            (result) => {
              if (invoiceRef.current !== invoiceId) return;
              if (result.ok) {
                paymentAttempt.current = null;
                setOutcomeUnknown(false);
                setPaymentRetryLast(false);
                setPaymentNewConfirmed(false);
                setReference("");
                // Recovery is a background refinement; the saved outcome and
                // invoice reload must not wait for it.
                void paymentRecovery.refresh();
                return;
              }
              if (result.conflict === "unknown") {
                setOutcomeUnknown(true);
              } else if (
                result.conflict === "cancelled" ||
                result.conflict === "already_recorded" ||
                result.conflict === "stale_observation"
              ) {
                paymentAttempt.current = null;
                setPaymentRetryLast(false);
                setPaymentNewConfirmed(false);
              }
              void paymentRecovery.refresh().then((refreshed) => {
                if (
                  result.conflict === "stale_observation" &&
                  refreshed?.ambiguous
                ) {
                  setMessage(AMBIGUOUS_RECOVERY_BLOCKED);
                }
              });
            },
          );
        }}
        className="mt-3"
      >
        {busy
          ? "Saving…"
          : paymentRecovery.recovery.open
            ? "Continue earlier attempt"
            : paymentRetryLast
              ? "Retry the same payment"
              : paymentNewConfirmed
                ? "Record a separate payment"
                : paymentRecovery.recovery.lastCommitted
                  ? "Choose a recovery option first"
                  : "Record payment"}
      </Button>
      <PaymentRecoveryNotice
        recovery={paymentRecovery.recovery}
        checking={paymentRecovery.checking}
        checkError={paymentRecovery.checkError}
        cancelError={paymentRecovery.cancelError}
        retryLast={paymentRetryLast}
        newConfirmed={paymentNewConfirmed}
        ambiguousMessage={AMBIGUOUS_PAYMENT}
        onRetryCheck={() => void paymentRecovery.refresh()}
        onCancel={() => {
          void (async () => {
            if (await paymentRecovery.cancel()) {
              paymentAttempt.current = null;
              setOutcomeUnknown(false);
              setPaymentRetryLast(false);
              setPaymentNewConfirmed(false);
            }
          })();
        }}
        onRetryLast={() => {
          setPaymentRetryLast(true);
          setPaymentNewConfirmed(false);
        }}
        onRecordNew={() => {
          setPaymentNewConfirmed(true);
          setPaymentRetryLast(false);
          paymentAttempt.current = null;
        }}
      />
    </div>
  );
}
