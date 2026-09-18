"use client";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatINR } from "@/lib/money/format";
import { formatTimeIST } from "@/lib/time/tz";
import type { BookingDayRow } from "@/lib/services/bookings";

// V-04 — the day board: every booking for the chosen facility and
// date, with the two counter actions. A walk-in row states, in the
// row, why it cannot be billed; the bill action is absent rather
// than disabled-and-mysterious. Cancelling is available on any live
// row (the server refuses completed/cancelled ones).

const STATUS_LABEL: Record<string, string> = {
  held: "Held",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  completed: "Completed",
};

export function BookingDayList({
  rows,
  busyId,
  onCancel,
  onBill,
}: {
  rows: BookingDayRow[];
  busyId: string | null;
  onCancel: (row: BookingDayRow) => void;
  onBill: (row: BookingDayRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No bookings on this day"
        body="Pick a facility, date and slot above to put the first one on the board."
      />
    );
  }

  return (
    <ul className="divide-y divide-line" data-testid="booking-day-list">
      {rows.map((row) => {
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
              <div className="mt-2 flex gap-2">
                {row.memberId ? (
                  <Button
                    variant={paid ? "ghost" : "secondary"}
                    size="sm"
                    disabled={busyId === row.bookingId}
                    onClick={() => onBill(row)}
                    data-testid="booking-bill-button"
                  >
                    {paid
                      ? "View bill"
                      : row.invoiceId
                        ? "Collect"
                        : "Request bill"}
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
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
