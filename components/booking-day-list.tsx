"use client";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatINR } from "@/lib/money/format";
import { wallClock } from "@/components/owner-calendar/calendar-layout";
import { formatTimeIST, formatWallTime12h } from "@/lib/time/tz";
import { slotEnd } from "@/components/booking-shared";
import type { BookingDayRow } from "@/lib/services/bookings";

// V-04 — the day board: every booking for the chosen facility and
// date, with the two counter actions. A walk-in row states, in the
// row, why it cannot be billed; the bill action is absent rather
// than disabled-and-mysterious. Cancelling is available on any live
// row (the server refuses completed/cancelled ones).
//
// Owner OpenPen (29 October 2026) — the board is a real slot board:
// free configured hours sit beside booked ones and "Choose slot" moves
// the selected hour into the form. Availability is derived from the
// rows already read for this facility/day; no extra read and no
// invented price.

const STATUS_LABEL: Record<string, string> = {
  held: "Held",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  completed: "Completed",
};

function slotMinutes(slot: string): number {
  const [hours, minutes] = slot.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function bookingOverlapsSlot(row: BookingDayRow, slot: string): boolean {
  if (row.status === "cancelled") return false;
  const start = wallClock(row.startsAt).minutes;
  const end = start + Math.max(
    1,
    Math.round(
      (new Date(row.endsAt).getTime() - new Date(row.startsAt).getTime()) /
        60_000,
    ),
  );
  return start < slotMinutes(slotEnd(slot)) && end > slotMinutes(slot);
}

export function BookingDayList({
  rows,
  busyId,
  onCancel,
  onBill,
  slots,
  onChooseSlot,
}: {
  rows: BookingDayRow[];
  busyId: string | null;
  onCancel: (row: BookingDayRow) => void;
  onBill: (row: BookingDayRow) => void;
  /**
   * The configured hourly starts for this desk. When supplied, free
   * hours are offered alongside the bookings; the caller owns which
   * slot is selected.
   */
  slots?: ReadonlyArray<string>;
  onChooseSlot?: (slot: string) => void;
}) {
  if (rows.length === 0 && !slots?.length) {
    return (
      <EmptyState
        title="No bookings on this day"
        body="Pick a facility, date and slot above to put the first one on the board."
      />
    );
  }

  const bookedMinutes = rows
    .filter((row) => row.status !== "cancelled")
    .map((row) => wallClock(row.startsAt).minutes);

  // Interleave real bookings and free configured hours by the time they
  // start, so the board reads like a day rather than two lists.
  type Entry =
    | { kind: "booking"; minute: number; row: BookingDayRow }
    | { kind: "slot"; minute: number; slot: string };

  const entries: Entry[] = rows.map((row) => ({
    kind: "booking",
    minute: wallClock(row.startsAt).minutes,
    row,
  }));

  if (slots?.length && onChooseSlot) {
    for (const slot of slots) {
      const occupied = rows.some((row) => bookingOverlapsSlot(row, slot));
      if (!occupied && !bookedMinutes.includes(slotMinutes(slot))) {
        entries.push({ kind: "slot", minute: slotMinutes(slot), slot });
      }
    }
  }

  entries.sort((a, b) => a.minute - b.minute || (a.kind === "booking" ? -1 : 1));

  return (
    <ul className="divide-y divide-line" data-testid="booking-day-list">
      {entries.map((entry) => {
        if (entry.kind === "slot") {
          const start = entry.slot;
          return (
            <li key={`slot-${start}`} className="py-3" data-testid="booking-slot-row">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium tabular-nums text-ink">
                    {formatWallTime12h(start)}–{formatWallTime12h(slotEnd(start))}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-ink-3">Available</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onChooseSlot?.(start)}
                >
                  Choose slot
                </Button>
              </div>
            </li>
          );
        }
        const row = entry.row;
        const cancelled = row.status === "cancelled";
        const paid = row.invoiceId !== null && row.amountDuePaise === 0;
        return (
          <li key={row.bookingId} className="py-3" data-testid="booking-row">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-ink">
                  {formatTimeIST(row.startsAt)}–{formatTimeIST(row.endsAt)}
                </p>
                <p className="text-[12px] text-ink-3">
                  {row.facilityName}
                  {row.subUnitName ? ` · ${row.subUnitName}` : ""}
                </p>
                <p className="mt-0.5 text-[13px] text-ink-2">
                  {row.memberName ?? row.walkInName}
                  <span className="text-ink-3">
                    {" "}
                    · {STATUS_LABEL[row.status] ?? row.status}
                  </span>
                </p>
                {row.walkInName ? (
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    Walk-in · not billable in R1
                  </p>
                ) : null}
              </div>
              <div className="flex-none text-right">
                <p className="text-[14px] font-medium text-ink tabular-nums">
                  {formatINR(row.pricePaise)}
                </p>
                {paid ? (
                  <p className="mt-1 text-[11px] font-medium text-good">Paid</p>
                ) : null}
              </div>
            </div>

            {!cancelled ? (
              <BookingRowActions
                row={row}
                busyId={busyId}
                onCancel={onCancel}
                onBill={onBill}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The two counter actions for a live booking.
 *
 * Exported so the calendar's detail panel offers the SAME actions —
 * a booking opened from the calendar is the same booking, and it must
 * not be a read-only version of it.
 */
export function BookingRowActions({
  row,
  busyId,
  onCancel,
  onBill,
}: {
  row: BookingDayRow;
  busyId: string | null;
  onCancel: (row: BookingDayRow) => void;
  onBill: (row: BookingDayRow) => void;
}) {
  const paid = row.invoiceId !== null && row.amountDuePaise === 0;
  return (
    <div className="mt-2 flex gap-2">
      {row.memberId ? (
        <Button
          variant={paid ? "ghost" : "secondary"}
          size="sm"
          disabled={busyId === row.bookingId}
          onClick={() => onBill(row)}
          data-testid="booking-bill-button"
        >
          {paid ? "View bill" : row.invoiceId ? "Collect" : "Request bill"}
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        disabled={busyId === row.bookingId}
        onClick={() => onCancel(row)}
        data-testid="booking-cancel-button"
      >
        Cancel
      </Button>
    </div>
  );
}
