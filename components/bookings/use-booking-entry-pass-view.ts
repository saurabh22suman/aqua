"use client";

import { useEffect, useRef, useState } from "react";
import { readBookingEntryPassView } from "./booking-entry-actions.client";
import type {
  BookingEntryPassState,
  ReadEntryPassViewResult,
} from "./booking-entry-shared";

// THE SINGLE LOADER for the authoritative pass view.
//
// The screen owns the bill and the payment transition; the receipt renders the
// state it is given and never constructs a view from the bill. This hook is the
// only product code that calls `readBookingEntryPassView`.
//
// v3 correction: the previous packet put the effect in the screen and had no
// test for generation, focus, refetch or unmount. This extraction keeps ONE
// implementation and makes the request lifecycle directly testable:
//
//   * a response is accepted only for the request that is still current;
//   * changing the booking OR the invoice starts a new identity and shows
//     `loading` synchronously (no stale view for a reissued document);
//   * a background focus/visibility refetch preserves a ready view instead of
//     flashing `loading`;
//   * a failed refetch becomes `error`, hiding the pass (fail closed);
//   * unmount disposes the controller, so a late response cannot call back.
//
// The receipt also compares `view.invoiceId` with `bill.invoiceId`. The hook
// rejects a view whose booking/invoice identity does not match the bill on
// screen, so a cross-invoice response cannot even reach the receipt as `ready`.

export type PassViewIdentity = {
  bookingId: string;
  invoiceId: string;
};

export type PassViewRequest = {
  load(
    identity: PassViewIdentity,
    onResult: (result: ReadEntryPassViewResult) => void,
  ): void;
  invalidate(): void;
  dispose(): void;
};

/**
 * The request controller, exported for the agent-owned lifecycle test.
 *
 * It is deliberately tiny: a generation counter and a disposed flag. The
 * adapter is injectable only for the test; production uses the real client
 * adapter default.
 */
export function createPassViewRequest(
  read: typeof readBookingEntryPassView = readBookingEntryPassView,
): PassViewRequest {
  let generation = 0;
  let disposed = false;

  return {
    load(identity, onResult) {
      if (disposed) return;
      const request = generation + 1;
      generation = request;
      void read(identity.bookingId)
        .then((result) => {
          if (disposed || request !== generation) return;
          onResult(result);
        })
        .catch(() => {
          if (disposed || request !== generation) return;
          onResult({
            ok: false,
            error: "Entry pass availability could not be checked.",
          });
        });
    },
    invalidate() {
      generation += 1;
    },
    dispose() {
      disposed = true;
      generation += 1;
    },
  };
}

type LoadedEntry = {
  key: string;
  state: BookingEntryPassState;
};

export function useBookingEntryPassView(
  bill: { bookingId: string; invoiceId: string } | null,
  settled: boolean,
): BookingEntryPassState {
  const [entry, setEntry] = useState<LoadedEntry | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const readyKey = useRef<string | null>(null);

  const bookingId = bill?.bookingId ?? null;
  const invoiceId = bill?.invoiceId ?? null;
  const key = bookingId && invoiceId ? `${bookingId}:${invoiceId}` : null;

  useEffect(() => {
    if (!bookingId || !invoiceId || !settled) {
      readyKey.current = null;
      return;
    }

    // One controller per request effect. On a dependency change or unmount,
    // the cleanup disposes it, so a late response cannot call back. Creating it
    // inside the effect also keeps React StrictMode's setup/cleanup/setup cycle
    // safe: the second setup gets a fresh controller, not a disposed one.
    const controller = createPassViewRequest();
    const identity = { bookingId, invoiceId };
    const requestKey = `${bookingId}:${invoiceId}`;
    // A ready view survives a background refetch for the same identity. A new
    // bill or a reissued invoice has a different key, so loading is shown in
    // the same commit, before this effect runs.
    if (readyKey.current !== requestKey) {
      setEntry({ key: requestKey, state: { state: "loading" } });
    }

    controller.load(identity, (result) => {
      if (!result.ok) {
        readyKey.current = null;
        setEntry({ key: requestKey, state: { state: "error" } });
        return;
      }
      if (
        result.view.bookingId !== identity.bookingId ||
        result.view.invoiceId !== identity.invoiceId
      ) {
        // A response for a replaced document or another booking is not this
        // receipt's view. Fail closed rather than render the wrong money facts.
        readyKey.current = null;
        setEntry({ key: requestKey, state: { state: "error" } });
        return;
      }
      readyKey.current = requestKey;
      setEntry({ key: requestKey, state: { state: "ready", view: result.view } });
    });

    return () => controller.dispose();
  }, [bookingId, invoiceId, settled, refreshKey]);

  // A receipt can stay open while another device checks the guest in, reverses
  // the payment or cancels the booking. Refetch on focus/visibility. The scan
  // remains the admission authority if this snapshot is stale.
  useEffect(() => {
    if (!bookingId || !invoiceId || !settled) return;
    function recheck() {
      setRefreshKey((value) => value + 1);
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") recheck();
    }
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [bookingId, invoiceId, settled]);

  if (!key || !settled) return { state: "loading" };
  return entry && entry.key === key ? entry.state : { state: "loading" };
}
