// Confirmed accounting policy (local KhelSuite audit batch, 21 November
// 2026): when a booking is cancelled after its invoice was issued, the
// balance and every payment already recorded stay on the document, but
// new collection is HELD FOR OWNER REVIEW. There is no automatic void,
// refund, reversal, write-off or release in this policy — an owner
// reviews the document as a separate, deliberate act.
//
// This module is deliberately PURE. The invoice read projections, the
// server-side eligibility helper and the client surfaces all share the
// same stable token and copy without pulling a database module into a
// client bundle.

export const COLLECTION_HOLD_BOOKING_CANCELLED = "booking_cancelled" as const;

export type CollectionHold = typeof COLLECTION_HOLD_BOOKING_CANCELLED;

export type CollectionHoldCopy = {
  /** The short status word for a list row or pill. */
  label: string;
  /** What remains visible, and why new collection is paused. */
  description: string;
  /** The refusal a payment service returns to the operator. */
  refusal: string;
};

export const COLLECTION_HOLD_COPY: Record<CollectionHold, CollectionHoldCopy> = {
  [COLLECTION_HOLD_BOOKING_CANCELLED]: {
    label: "Held for owner review",
    description:
      "The booking was cancelled. Its remaining balance is on hold for owner review.",
    refusal:
      "Collection is held because the booking was cancelled. Ask an owner to review the invoice.",
  },
};

/**
 * Normalise a projection value to the shared token. Any unexpected value
 * (including null) is treated as "no hold", so a future hold kind cannot
 * be silently rendered by a surface that does not know it yet.
 */
export function asCollectionHold(
  value: string | null | undefined,
): CollectionHold | undefined {
  return value === COLLECTION_HOLD_BOOKING_CANCELLED
    ? COLLECTION_HOLD_BOOKING_CANCELLED
    : undefined;
}
