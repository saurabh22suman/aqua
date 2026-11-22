import type { PaymentIntentRecovery } from "@/lib/services/payment-intent-recovery";

// One gate for every bill-linked QR. A new payment request is offered only
// when the form is idle AND the server recovery read found no open/ambiguous
// attempt. A retained page-local key after a thrown request blocks a new QR
// even when the re-read is empty: the operator must retry the same recording.
export function recoveryQrBlockedReason(input: {
  busy: boolean;
  outcomeUnknown: boolean;
  ready: boolean;
  recovery: PaymentIntentRecovery;
  newConfirmed: boolean;
}): string | undefined {
  if (input.busy) {
    return "Recording is in progress. Wait for the result before showing a new QR.";
  }
  if (input.outcomeUnknown) {
    return "The last recording outcome is unknown. Retry the same recording before showing a new QR.";
  }
  if (!input.ready) {
    return "Check for an earlier attempt before showing a QR.";
  }
  if (input.recovery.open || input.recovery.ambiguous) {
    return "Resolve the earlier attempt in this form before showing a new payment QR.";
  }
  if (input.recovery.lastCommitted && !input.newConfirmed) {
    return "Choose Retry the same payment or Record a separate payment in the recovery notice before showing a new QR.";
  }
  return undefined;
}
