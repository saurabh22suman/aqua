// Plain recovery copy shared by the payment and reversal surfaces.
// It deliberately avoids "key", "payload", "chain" and "committed" jargon.
// There is no Ops repair action in this release, so the copy never promises
// that an administrator can review or clear the record from this app.

export type RecoveryOperation = "payment" | "reversal";
export type RecoveryDocument = "invoice" | "bill" | "payment";

export const AMBIGUOUS_RECOVERY_NOTICE =
  "The earlier records for this document conflict, so a new payment or reversal cannot be started here. You can still continue or discard an unfinished attempt. This needs manual resolution outside this screen; there is no automatic repair.";

export const AMBIGUOUS_RECOVERY_BLOCKED =
  "A new operation cannot be started here until the conflicting record is resolved.";

export function ambiguousRecoveryMessage(
  operation: RecoveryOperation,
  document: RecoveryDocument,
): string {
  return `The earlier ${operation} records for this ${document} conflict, so a new ${operation} cannot be started here. This needs manual resolution outside this screen; there is no automatic repair.`;
}
