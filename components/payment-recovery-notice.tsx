"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatDateTimeIST } from "@/lib/time/tz";
import type { PaymentIntentRecovery } from "@/lib/services/payment-intent-recovery";
import {
  AMBIGUOUS_RECOVERY_NOTICE,
  type RecoveryOperation,
} from "@/components/payment-recovery-copy";

// F01 — what the server already knows about this document, without a
// browser store.
//
// The first submit is gated by the hook's `ready` (a completed
// successful read for the current target). A failed read keeps the form
// blocked; there is no "record anyway" bypass.
//
// `open` is a prepared attempt: the commit transaction writes the money
// and the committed marker together, so at the moment of the read no
// money had been recorded. The copy is snapshot-qualified because a
// commit can race the read; the server's discard is authoritative and
// will refuse a committed row.
//
// `lastCommitted` is durable and is shown until the operator makes an
// explicit choice: Retry the last recorded operation with its own key,
// or Record a new operation with a new key (two-step confirmation).
// There is no 10-minute hide: durable recovery is not an expiring notice.

export function PaymentRecoveryAmbiguityNotice({
  message = AMBIGUOUS_RECOVERY_NOTICE,
}: {
  message?: string;
}) {
  return (
    <div
      role="alert"
      data-testid="payment-recovery-ambiguous"
      className="rounded-ctl border border-line bg-paper px-3 py-2 text-[12px] text-ink"
    >
      {message}
    </div>
  );
}

type Props = {
  recovery: PaymentIntentRecovery;
  checking: boolean;
  checkError: string | null;
  cancelError: string | null;
  retryLast: boolean;
  newConfirmed: boolean;
  onRetryCheck: () => void;
  onCancel: () => void;
  onRetryLast: () => void;
  onRecordNew: () => void;
  newLabel?: string;
  retryLabel?: string;
  subjectLabel?: RecoveryOperation;
  sameDetailsLabel?: string;
  reloadDetailsLabel?: string;
  ambiguousMessage?: string;
};

export function PaymentRecoveryNotice({
  recovery,
  checking,
  checkError,
  cancelError,
  retryLast,
  newConfirmed,
  onRetryCheck,
  onCancel,
  onRetryLast,
  onRecordNew,
  newLabel = "Record a separate payment",
  retryLabel = "Retry the same payment",
  subjectLabel = "payment",
  sameDetailsLabel = "amount, payment method and reference",
  reloadDetailsLabel = "amount, method or reference",
  ambiguousMessage = AMBIGUOUS_RECOVERY_NOTICE,
}: Props) {
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [confirmingNew, setConfirmingNew] = useState(false);
  const openId = recovery.open?.intentId ?? null;
  const lastId = recovery.lastCommitted?.intentId ?? null;
  const ambiguityNotice = recovery.ambiguous ? (
    <PaymentRecoveryAmbiguityNotice message={ambiguousMessage} />
  ) : null;

  useEffect(() => {
    setConfirmingDiscard(false);
    setConfirmingNew(false);
  }, [openId, lastId]);

  if (checking) {
    return (
      <p
        role="status"
        className="rounded-ctl border border-line bg-deck px-3 py-2 text-[12px] text-ink"
      >
        Checking for an earlier attempt on this document…
      </p>
    );
  }

  if (checkError) {
    return (
      <div
        role="status"
        className="space-y-2 rounded-ctl border border-line bg-warn-soft px-3 py-2 text-[12px] text-ink"
      >
        <p>{checkError}</p>
        <Button type="button" variant="secondary" size="sm" onClick={onRetryCheck}>
          Retry check
        </Button>
      </div>
    );
  }

  const { open, lastCommitted } = recovery;
  if (!open && !lastCommitted && recovery.ambiguous) {
    return <div className="space-y-2">{ambiguityNotice}</div>;
  }
  if (open) {
    return (
      <div className="space-y-2 rounded-ctl border border-line bg-warn-soft px-3 py-2 text-[12px] text-ink">
        {ambiguityNotice}
        <p role="status">
          An earlier attempt on this document was unfinished when checked on{" "}
          {formatDateTimeIST(open.createdAt)}. No money had been recorded at that
          point. If it has since completed, discarding will be refused.
        </p>
        <p className="text-ink-2">
          This screen does not reload the earlier {reloadDetailsLabel}. Re-enter
          the same details to continue; changed details are refused. To change
          them, discard this unfinished attempt first. Discarding it does not
          delete a recorded {subjectLabel}.
        </p>
        {confirmingDiscard ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setConfirmingDiscard(false);
                onCancel();
              }}
            >
              Confirm discard
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingDiscard(false)}
            >
              Keep it
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirmingDiscard(true)}
          >
            Discard unfinished attempt
          </Button>
        )}
        {cancelError ? (
          <p role="alert" className="text-ink">
            {cancelError}
          </p>
        ) : null}
      </div>
    );
  }

  if (lastCommitted) {
    return (
      <div className="space-y-2 rounded-ctl border border-line bg-deck px-3 py-2 text-[12px] text-ink">
        {ambiguityNotice}
        <p role="status">
          Your last recorded {subjectLabel} on this document was saved on{" "}
          {formatDateTimeIST(lastCommitted.committedAt)} (application timestamp).
          The document now shows {lastCommitted.invoiceStatus ?? "an unknown status"}.
        </p>
        <p className="text-ink-2">
          Retry the same {subjectLabel} using the same {sameDetailsLabel}. A
          changed {reloadDetailsLabel} is refused. Choose &ldquo;{newLabel}&rdquo;
          only for a different {subjectLabel}.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={retryLast ? "primary" : "secondary"}
            size="sm"
            onClick={onRetryLast}
          >
            {retryLabel}
          </Button>
          {confirmingNew ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setConfirmingNew(false);
                  onRecordNew();
                }}
              >
                Confirm new operation
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingNew(false)}
              >
                Keep last
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant={newConfirmed ? "primary" : "ghost"}
              size="sm"
              onClick={() => setConfirmingNew(true)}
            >
              {newLabel}
            </Button>
          )}
        </div>
        {newConfirmed ? (
          <p className="text-ink-2">
            Separate {subjectLabel} confirmed: press the form&apos;s record button
            to start it.
          </p>
        ) : null}
      </div>
    );
  }

  return null;
}
