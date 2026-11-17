"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { scanBookingEntryPass } from "./booking-entry-actions.client";
import type { BookingEntryScanEntry } from "./booking-entry-shared";

// The counter's scanner toggle. It is a container: the scanner itself stays
// presentational and receives the real action through this adapter.
//
// `canScan` is the page's `bookings.write` decision. It is an affordance gate,
// not the authority: `checkInBookingAction` checks the permission again on the
// server. A caller that forgets the flag gets no button; the action still
// refuses.
//
// The scanner chunk is loaded only when the staff member opens it, keeping it
// out of the booking desk's first load. No new dependency.

const BookingEntryScanner = dynamic(
  () =>
    import("./booking-entry-scanner").then(
      (module) => module.BookingEntryScanner,
    ),
  {
    loading: () => (
      <p role="status" className="text-[13px] text-ink-3">
        Opening the scanner…
      </p>
    ),
  },
);

export function BookingEntryScannerPanel({
  canScan,
  onCheckedIn,
}: {
  canScan: boolean;
  onCheckedIn?: (entry: BookingEntryScanEntry) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!canScan) return null;

  return (
    <div className="min-w-0">
      <Button
        variant="secondary"
        size="md"
        className="w-full sm:w-auto"
        aria-expanded={open}
        aria-controls="booking-entry-scanner-panel"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide scanner" : "Scan entry pass"}
      </Button>
      {open ? (
        <div id="booking-entry-scanner-panel" className="mt-3">
          <BookingEntryScanner
            onScan={async (token) => {
              const result = await scanBookingEntryPass(token);
              if (result.ok) {
                try {
                  onCheckedIn?.(result.entry);
                } catch {
                  // A parent refresh failure must not turn a recorded
                  // check-in into an apparent failure.
                }
              }
              return result;
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
