"use client";

import { useEffect, useState } from "react";
import {
  cancelPaymentRecoveryAction,
  listPaymentRecoveryAction,
} from "@/lib/actions/payment-intents";
import { formatDateTimeIST } from "@/lib/time/tz";
import { Button } from "@/components/ui/Button";
import { PaymentRecoveryAmbiguityNotice } from "@/components/payment-recovery-notice";
import { usePaymentRecovery } from "@/components/use-payment-recovery";
import { ambiguousRecoveryMessage } from "@/components/payment-recovery-copy";

// A reload has three honest outcomes: it applied, it failed, or a newer
// invoice/sequence superseded it. "superseded" is not a failure: the newer
// load already reconciled the panel.
export type InvoiceReloadResult = "ok" | "failed" | "superseded";

export function InvoiceClosedRecovery({
  invoiceId,
  canRecord,
  onReload,
  onMessage,
}: {
  invoiceId: string;
  canRecord: boolean;
  onReload: () => Promise<InvoiceReloadResult>;
  onMessage: (message: string | null) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const {
    recovery,
    cancelError,
    cancel,
    refresh,
  } = usePaymentRecovery(
    invoiceId,
    listPaymentRecoveryAction,
    cancelPaymentRecoveryAction,
  );
  const openId = recovery.open?.intentId ?? null;

  useEffect(() => {
    setConfirming(false);
    setResult(null);
  }, [invoiceId]);
  useEffect(() => {
    setConfirming(false);
  }, [openId]);

  if (!canRecord || (!recovery.open && !result)) return null;

  return (
    <>
      {recovery.open ? (
        <div
          className="mt-2 rounded-ctl border border-line bg-warn-soft p-3"
          data-testid="closed-intent-recovery"
        >
          {recovery.ambiguous ? (
            <PaymentRecoveryAmbiguityNotice
              message={ambiguousRecoveryMessage("payment", "invoice")}
            />
          ) : null}
          <p role="status" className="text-[12px] text-ink">
            When checked on {formatDateTimeIST(recovery.open.createdAt)}, an
            earlier prepared attempt on this closed invoice had recorded no
            money. If it has since committed, discarding will be refused and the
            payment will appear below; if your location access changed, it cannot
            be discarded here.
          </p>
          {confirming ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setConfirming(false);
                  void (async () => {
                    const discarded = await cancel();
                    if (discarded) {
                      setResult(null);
                    } else {
                      const resultText =
                        "The attempt could not be discarded. The attempt and this invoice were rechecked; review the payment list before retrying.";
                      setResult(resultText);
                      // A refused discard can hide a commit or a scope change:
                      // reconcile the invoice and payment list as well. If that
                      // reconciliation fails, keep the discard outcome visible
                      // above the failed-load state.
                      const reload = await onReload();
                      if (reload === "failed") {
                        onMessage(resultText);
                      }
                      return;
                    }
                    await onReload();
                  })();
                }}
              >
                Confirm discard
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(false)}
              >
                Keep it
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() => setConfirming(true)}
            >
              Discard earlier attempt
            </Button>
          )}
          {cancelError ? (
            <p role="alert" className="mt-2 text-[12px] text-ink">
              {cancelError}
            </p>
          ) : null}
        </div>
      ) : null}

      {!recovery.open && result ? (
        <div
          className="mt-2 rounded-ctl border border-line bg-deck p-3"
          data-testid="closed-intent-result"
        >
          <p role="status" className="text-[12px] text-ink">
            {result}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => {
              setResult(null);
              void refresh();
              void onReload();
            }}
          >
            Recheck
          </Button>
        </div>
      ) : null}
    </>
  );
}
