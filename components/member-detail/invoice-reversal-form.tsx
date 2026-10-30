"use client";

import { useRef, useState } from "react";
import { cancelReversalRecoveryAction, listReversalRecoveryAction } from "@/lib/actions/payment-intents";
import { reversePaymentAction } from "@/lib/actions/payment-reversals";
import type { PaymentRow } from "@/lib/services/payments";
import { parseRupeesToPaise } from "@/lib/payment-qr";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PaymentRecoveryNotice } from "@/components/payment-recovery-notice";
import { usePaymentRecovery } from "@/components/use-payment-recovery";
import { ambiguousRecoveryMessage } from "@/components/payment-recovery-copy";
import { mintPaymentKey } from "@/lib/payment-key";
import type { InvoiceReloadResult } from "@/components/member-detail/invoice-closed-recovery";

const AMBIGUOUS_REVERSAL = ambiguousRecoveryMessage("reversal", "payment");

export function InvoiceReversalForm({
  payment,
  remainingPaise,
  busy,
  setBusy,
  onReload,
  onChanged,
  onMessage,
  onClose,
}: {
  payment: PaymentRow;
  remainingPaise: number;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onReload: () => Promise<InvoiceReloadResult>;
  onChanged: () => void;
  onMessage: (message: string | null) => void;
  onClose: () => void;
}) {
  const [reverseAmount, setReverseAmount] = useState(String(remainingPaise / 100));
  const [reverseReason, setReverseReason] = useState("");
  const [reverseError, setReverseError] = useState<string | null>(null);
  const [reversalRetryLast, setReversalRetryLast] = useState(false);
  const [reversalNewConfirmed, setReversalNewConfirmed] = useState(false);
  const reversalAttempt = useRef<{ targetId: string; key: string } | null>(null);
  const reversalRecovery = usePaymentRecovery(
    payment.id,
    listReversalRecoveryAction,
    cancelReversalRecoveryAction,
  );

  return (
    <div className="mt-1.5 rounded-ctl border border-line p-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="invoice-reverse-amount" label="Amount (₹)">
          {(field) => (
            <Input
              {...field}
              inputMode="decimal"
              value={reverseAmount}
              onChange={(e) => setReverseAmount(e.target.value)}
              data-testid="reverse-amount"
            />
          )}
        </Field>
        <Field id="invoice-reverse-reason" label="Reason">
          {(field) => (
            <Input
              {...field}
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              data-testid="reverse-reason"
            />
          )}
        </Field>
      </div>
      {reverseError ? (
        <p role="alert" className="mt-1 text-[11.5px] text-ink-2">
          {reverseError}
        </p>
      ) : null}
      <PaymentRecoveryNotice
        recovery={reversalRecovery.recovery}
        checking={reversalRecovery.checking}
        checkError={reversalRecovery.checkError}
        cancelError={reversalRecovery.cancelError}
        retryLast={reversalRetryLast}
        newConfirmed={reversalNewConfirmed}
        newLabel="Record a separate reversal"
        retryLabel="Retry the same reversal"
        subjectLabel="reversal"
        sameDetailsLabel="amount and reason"
        reloadDetailsLabel="amount or reason"
        ambiguousMessage={AMBIGUOUS_REVERSAL}
        onRetryCheck={() => void reversalRecovery.refresh()}
        onCancel={() => {
          void (async () => {
            if (await reversalRecovery.cancel()) {
              reversalAttempt.current = null;
              setReversalRetryLast(false);
              setReversalNewConfirmed(false);
            }
          })();
        }}
        onRetryLast={() => {
          setReversalRetryLast(true);
          setReversalNewConfirmed(false);
        }}
        onRecordNew={() => {
          setReversalNewConfirmed(true);
          setReversalRetryLast(false);
          reversalAttempt.current = null;
        }}
      />
      <button
        type="button"
        disabled={
          busy ||
          !reversalRecovery.ready ||
          (!reversalRecovery.recovery.open &&
            reversalRecovery.recovery.ambiguous === true) ||
          (!reversalRecovery.recovery.open &&
            reversalRecovery.recovery.lastCommitted !== null &&
            !reversalRetryLast &&
            !reversalNewConfirmed)
        }
        onClick={() => {
          const paise = parseRupeesToPaise(reverseAmount);
          if (paise === null || paise <= 0n) {
            setReverseError("Enter an amount like 2500 or 2500.50.");
            return;
          }
          if (reverseReason.trim().length < 3) {
            setReverseError("Give a reason (3-300 characters).");
            return;
          }
          if (!reversalRecovery.ready) {
            setReverseError(
              "Check for an earlier reversal attempt on this payment before confirming.",
            );
            return;
          }
          if (
            !reversalRecovery.recovery.open &&
            reversalRecovery.recovery.ambiguous
          ) {
            setReverseError(AMBIGUOUS_REVERSAL);
            return;
          }
          const last = reversalRecovery.recovery.lastCommitted;
          const stored =
            reversalAttempt.current?.targetId === payment.id
              ? reversalAttempt.current.key
              : null;
          let key: string | null;
          if (reversalRecovery.recovery.open) {
            key = reversalRecovery.recovery.open.idempotencyKey;
          } else if (reversalRetryLast && last) {
            key = last.idempotencyKey;
          } else if (last) {
            if (!reversalNewConfirmed) {
              setReverseError(
                "Choose “Retry the same reversal” or confirm “Record a separate reversal” above.",
              );
              return;
            }
            key = mintPaymentKey();
          } else {
            key = stored ?? mintPaymentKey();
          }
          if (!key) {
            setReverseError(
              "This browser cannot create a secure one-time key. Use a current browser and try again.",
            );
            return;
          }
          const observedIntentId = last?.intentId ?? null;
          reversalAttempt.current = { targetId: payment.id, key };
          setBusy(true);
          setReverseError(null);
          void (async () => {
            try {
              const result = await reversePaymentAction({
                paymentId: payment.id,
                amountPaise: Number(paise),
                reason: reverseReason.trim(),
                idempotencyKey: key,
                observedIntentId,
              });
              if (!result.ok) {
                if (
                  result.conflict === "cancelled" ||
                  result.conflict === "already_recorded" ||
                  result.conflict === "stale_observation"
                ) {
                  reversalAttempt.current = null;
                  setReversalRetryLast(false);
                  setReversalNewConfirmed(false);
                }
                setReverseError(result.error);
                void reversalRecovery.refresh().then((refreshed) => {
                  if (
                    result.conflict === "stale_observation" &&
                    refreshed?.ambiguous
                  ) {
                    // The notice already explains the conflicting records;
                    // do not keep a stale "choose again" message that cannot
                    // resolve it.
                    setReverseError(null);
                  }
                });
              } else {
                reversalAttempt.current = null;
                setReversalRetryLast(false);
                setReversalNewConfirmed(false);
                onClose();
                setReverseError(null);
                // The reversal is already committed. Keep the outcome visible
                // even when the follow-up load fails and the panel falls back
                // to its error state.
                onMessage("Reversal saved.");
                await onReload();
                onChanged();
                // The outcome is already known: the recovery re-read runs in
                // the background so a slow read cannot hold the shared busy
                // state.
                void reversalRecovery.refresh();
              }
            } catch {
              await onReload();
              // Unknown outcome: a thrown transport error is not proof of
              // failure. The message survives the failed-load early return and
              // is also visible in the loaded panel.
              onMessage(
                "The request did not complete. The payment was refreshed — check it before retrying, in case the reversal already went through.",
              );
              void reversalRecovery.refresh();
            } finally {
              setBusy(false);
            }
          })();
        }}
        className="mt-1.5 inline-flex min-h-11 items-center justify-center rounded-pill px-3.5 py-1.5 text-[12px] font-semibold text-paper bg-[var(--accent-strong)] hover:opacity-90 disabled:opacity-60"
      >
        {busy
          ? "Saving…"
          : reversalRecovery.recovery.open
            ? "Continue earlier attempt"
            : reversalRetryLast
              ? "Retry the same reversal"
              : reversalNewConfirmed
                ? "Record a separate reversal"
                : reversalRecovery.recovery.lastCommitted
                  ? "Choose above, then confirm"
                  : "Confirm reversal"}
      </button>
    </div>
  );
}
