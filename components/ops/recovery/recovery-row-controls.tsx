"use client";

// The Ops recovery console's write surface.
//
// FOUR audited actions, ONE reason field per row, and no new authority.
//
// WHAT THIS IS
//
// The console renders one of these per ATTENTION row. An attention row is
// an outbox row (db/platform-notifications.ts -> ops_notification_attention),
// so its id names a recoverable notification. The message-LEDGER list is a
// different id space (message_log rows) and carries NO control: the
// audited retry/dismiss mutation addresses the OUTBOX row
// (lib/actions/platform-failed-notifications.ts -> mutateExhausted), so a
// ledger id would always be a no-op that reads as a recovery.
//
// The four actions are the EXISTING ones (see recovery-actions.ts), called
// with the EXISTING FormData keys (notificationId, tenantId, reason).
// Nothing here widens permission: every action re-checks the operator on
// the server (requireOpsAdminAction), and the console only renders for an
// administrator at all (app/(platform)/ops/recovery/page.tsx).
//
// THE TRUTH RULES, in one place:
//   * a resend or a retry QUEUES another attempt. It never says the
//     message was delivered, because nothing knows that;
//   * a close or a dismissal ENDS the queueing of that notification. It
//     is a manual investigation decision, not a delivery confirmation,
//     and it says so;
//   * a refusal from the server (the row is no longer in that state) is
//     shown in the server's own words, never as a completed action;
//   * a response that never arrived is NOT "nothing was changed": the
//     write may already have committed, so the operator is told the
//     result is unconfirmed and is pointed at the record;
//   * a committed action NEVER removes a row locally. The console
//     re-reads the actual lists from the server (see recovery-console.tsx),
//     so the operator sees what the server holds, not a local guess.

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { controlsFor, type RecoveryControl } from "./recovery-actions";
import type { RecoveryCommitted, RecoveryRowKind } from "./recovery-data";

// The row kinds, re-exported for the modules that render these rows.
export type { RecoveryRowKind };

/** The reason bounds the audited actions accept (mutationInput). */
const MIN_REASON = 3;
const MAX_REASON = 500;

export function RecoveryRowControls({
  notificationId,
  tenantId,
  kind,
  onCommitted,
}: {
  notificationId: string;
  tenantId: string;
  kind: RecoveryRowKind;
  /**
   * Called after a committed action with the outcome sentence, so the
   * console can announce it and re-read the actual lists.
   */
  onCommitted?: RecoveryCommitted;
}) {
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  const trimmed = reason.trim();
  const reasonReady = trimmed.length >= MIN_REASON && trimmed.length <= MAX_REASON;
  const [primary, secondary] = controlsFor(kind);

  async function run(control: RecoveryControl) {
    if (busy) return;
    if (!reasonReady) {
      setOutcome({
        tone: "error",
        text: `Enter a reason of at least ${MIN_REASON} characters.`,
      });
      return;
    }
    // The duplicate risk is the RESEND's risk. A close carries no
    // duplicate-delivery risk, so it must not be held behind an answer
    // that was never asked for it.
    if (control.duplicateRisk && !acknowledged) {
      setOutcome({
        tone: "error",
        text: "Acknowledge the duplicate risk before resending.",
      });
      return;
    }
    const formData = new FormData();
    formData.set("notificationId", notificationId);
    formData.set("tenantId", tenantId);
    formData.set("reason", trimmed);
    setBusy(true);
    setPendingLabel(control.pending);
    setOutcome(null);
    try {
      const result = await control.action(null, formData);
      if (result.ok) {
        setOutcome({ tone: "ok", text: control.committed });
        setAcknowledged(false);
        setReason("");
        // The console announces the outcome and re-reads the ACTUAL
        // lists. Nothing is removed here.
        await onCommitted?.(control.committed);
      } else {
        setOutcome({ tone: "error", text: result.error });
      }
    } catch {
      // The request may already have committed on the server before the
      // response failed to arrive. Saying "nothing was changed" would be
      // a claim nobody can make, so the operator is told the truth and
      // pointed at the record.
      setOutcome({
        tone: "error",
        text:
          "The result could not be confirmed. Refresh the list and check the notification's record before trying again.",
      });
    } finally {
      setBusy(false);
      setPendingLabel(null);
    }
  }

  return (
    <div className="mt-3 border-t border-line pt-3" aria-busy={busy || undefined}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <label
            htmlFor={reasonId}
            className="mb-1 block text-[12px] font-medium text-ink-2"
          >
            Reason
          </label>
          <Input
            id={reasonId}
            name="reason"
            required
            value={reason}
            maxLength={MAX_REASON}
            placeholder="Why is this notification being changed?"
            onChange={(event) => setReason(event.currentTarget.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={() => void run(primary)}
          >
            {primary.label}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void run(secondary)}
          >
            {secondary.label}
          </Button>
        </div>
      </div>

      {primary.duplicateRisk ? (
        <div className="mt-2">
          <Checkbox checked={acknowledged} onCheckedChange={setAcknowledged}>
            I understand that a resend may reach the recipient a second time.
          </Checkbox>
        </div>
      ) : null}

      {busy ? (
        <p role="status" className="mt-2 text-[12px] text-ink-3">
          {pendingLabel ?? "Working…"}
        </p>
      ) : null}
      {outcome ? (
        <p
          role={outcome.tone === "error" ? "alert" : "status"}
          className="mt-2 text-[12px] text-ink-2"
        >
          {outcome.text}
        </p>
      ) : null}
    </div>
  );
}
