// Shared, presentation-safe types for the paid-booking entry UI.
//
// v3 correction: the authoritative view carries enough identity and time truth
// for the receipt to refuse a stale document and for the pass to suppress a
// mint after the booking's end. It still contains no server code and no action
// import. `canMint` is the caller's `bookings.read` decision, set by the action
// only after `requirePermission`; `checkedInAt` is the recorded row, or null
// because the row was read and absent.
//
// There is deliberately NO `passViewFromBill` export in this revision. The
// legacy helper accepted `("confirmed", true, null)` and was the one-line
// footgun the coordinator finding named. The only mapper is
// `passViewFromAuthoritative`, which takes facts the read service produced.

export type BookingEntryPaymentState =
  | "paid"
  | "unpaid"
  | "partial"
  | "refunded";

/**
 * Only the literal `confirmed` status is eligible. `cancelled` and `completed`
 * stay distinct so their copy can be specific; `held`, unknown, future, null
 * and missing statuses all fail closed to `unavailable`, which is never
 * described as a cancellation.
 */
export type BookingEntryBookingStatus =
  | "confirmed"
  | "cancelled"
  | "completed"
  | "unavailable";

export type BookingEntryWindowState = "open" | "too_early" | "closed";

/**
 * The server-resolved state of the human-set window:
 *
 *   [starts_at - 30 minutes, ends_at)
 *
 * `opensAt` is inclusive and `closesAt` is exclusive. The value is computed by
 * the read service from persisted instants and the server clock. The UI never
 * derives it from the browser clock and never treats it as an admission: the
 * scan action remains the only admission decision.
 */
export type BookingEntryWindow = {
  state: BookingEntryWindowState;
  opensAt: string;
  closesAt: string;
};

export type BookingEntryPassView = {
  bookingId: string;
  /**
   * The exact invoice document these money facts belong to.
   *
   * The receipt requires this to equal its own `bill.invoiceId`. A view for a
   * replaced/voided invoice is never rendered against the old receipt.
   */
  invoiceId: string | null;
  facilityName: string;
  startsAt: string;
  endsAt: string;
  bookingStatus: BookingEntryBookingStatus;
  paymentState: BookingEntryPaymentState;
  /** The server's `bookings.read` decision for this caller. */
  canMint: boolean;
  /** Present only when the booking already has its one recorded entry. */
  checkedInAt?: string | null;
  /**
   * Server-owned. Optional only so direct component-contract tests can omit
   * it; the read action always supplies it.
   */
  entryWindow?: BookingEntryWindow;
};

/**
 * The receipt's complete pass state.
 *
 * There is deliberately no `default` or "assume confirmed" member. A caller
 * that does not have an authoritative view must omit the prop (or send
 * `error`), and the receipt renders no pass.
 */
export type BookingEntryPassState =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; view: BookingEntryPassView };

export type MintEntryPassResult =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; error: string };

export type ReadEntryPassViewResult =
  | { ok: true; view: BookingEntryPassView }
  | { ok: false; error: string };

export type BookingEntryScanEntry = {
  bookingId: string;
  checkedInAt: string;
  checkedInBy: string | null;
  method: "qr";
};

/**
 * `reason` is deliberately a plain string in the UI. The server's refusal set
 * is a closed union today, but the 30-minute window adds a reason; the scanner
 * must stay forward-compatible without forcing a test-side type edit from this
 * lane. Known reasons get their contract copy; unknown reasons get a generic
 * refusal and are never echoed raw.
 */
export type BookingEntryScanResult =
  | { ok: true; entry: BookingEntryScanEntry }
  | { ok: false; error: string; reason: string };

/** The human-approved scan window, in product words. */
export const ENTRY_WINDOW_RULE =
  "Entry is accepted from 30 minutes before the start until the booking ends.";

/**
 * The authoritative facts the read-only server action returns.
 *
 * Every field is a database read under `withTenant()` plus the existing
 * location visibility check. In particular:
 *   * `bookingStatus` is `bookings.status`, not the invoice's status;
 *   * `invoiceId` is the exact document `bookings.invoice_id` pointed at when
 *     the facts were read;
 *   * `checkedInAt` is the `booking_check_ins` row, or null after reading it —
 *     never a default supplied by the UI;
 *   * `entryWindow` is computed from the persisted booking instants and the
 *     server clock;
 *   * `canMint` is NOT part of these facts. The action adds it only after
 *     `requirePermission(ctx, "bookings.read")`.
 */
export type BookingEntryPassFacts = {
  bookingId: string;
  invoiceId: string | null;
  facilityName: string;
  startsAt: string;
  endsAt: string;
  /** `bookings.status` verbatim; unknown values fail closed below. */
  bookingStatus: string;
  /** The linked invoice's status, or "none" when the booking has no bill. */
  invoiceStatus: string;
  paidPaise: number;
  totalPaise: number;
  /** The recorded entry instant, or null because the row was read and absent. */
  checkedInAt: string | null;
  entryWindow: BookingEntryWindow;
};

function bookingStatusFrom(
  status: string | null | undefined,
): BookingEntryBookingStatus {
  switch (status) {
    case "confirmed":
      return "confirmed";
    case "cancelled":
      return "cancelled";
    case "completed":
      return "completed";
    default:
      // `held`, unknown, future, null or missing statuses are not confirmed
      // and must never mint a pass. They are not cancellations either.
      return "unavailable";
  }
}

function paymentStateFrom(facts: {
  invoiceStatus: string;
  amountDuePaise: number;
  totalPaise: number;
}): BookingEntryPaymentState {
  if (facts.invoiceStatus === "paid" && facts.amountDuePaise === 0) {
    return "paid";
  }
  if (facts.amountDuePaise > 0 && facts.amountDuePaise < facts.totalPaise) {
    return "partial";
  }
  // `issued`, `draft`, `void`, "none", or a reversed invoice: no pass. A
  // `refunded` view is a direct component-contract state only; the invoice
  // facts cannot tell a refund from a reversal and fail closed to unpaid.
  return "unpaid";
}

/**
 * Build the pass view from the server's authoritative facts.
 *
 * `canMint` may be true ONLY when the caller has passed the action's
 * `bookings.read` check. It must never be defaulted by a component, a bill
 * fact or a page prop. This function does not read a database or a request.
 */
export function passViewFromAuthoritative(
  facts: BookingEntryPassFacts,
  canMint: boolean,
): BookingEntryPassView {
  return {
    bookingId: facts.bookingId,
    invoiceId: facts.invoiceId,
    facilityName: facts.facilityName,
    startsAt: facts.startsAt,
    endsAt: facts.endsAt,
    bookingStatus: bookingStatusFrom(facts.bookingStatus),
    paymentState: paymentStateFrom({
      invoiceStatus: facts.invoiceStatus,
      amountDuePaise: Math.max(0, facts.totalPaise - facts.paidPaise),
      totalPaise: facts.totalPaise,
    }),
    canMint,
    checkedInAt: facts.checkedInAt,
    entryWindow: facts.entryWindow,
  };
}
