"use client";

import { useEffect, useMemo, useState } from "react";
import { BookingForm } from "@/components/booking-form";
import { BookingDayList } from "@/components/booking-day-list";
import {
  BookingBillPanel,
  BookingReceipt,
} from "@/components/booking-bill-panel";
import {
  cancelBookingAction,
  listBookingsAction,
  requestBookingBillAction,
} from "@/lib/actions/bookings";
import type { PaymentMethod } from "@/components/cafe-order-shared";
import type { BookableFacility, BookingDayRow } from "@/lib/services/bookings";
import type { BookingBill } from "@/lib/services/booking-billing";
import type { TerminologyState } from "@/lib/terminology/keys";

// V-04 — the reception booking counter: the create form, the day
// board and the bill/collect split. Once a bill is open the screen
// becomes the bill (Request bill → amount visible → Collect →
// receipt), the same shape as the café counter.

export function BookingScreen({
  facilities,
  timezone,
  today,
  terminology,
}: {
  facilities: BookableFacility[];
  timezone: string;
  today: string;
  terminology: TerminologyState;
}) {
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState<BookingDayRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [bill, setBill] = useState<BookingBill | null>(null);
  const [paid, setPaid] = useState(false);
  const [paidMethod, setPaidMethod] = useState<PaymentMethod>("cash");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedFacility = useMemo(
    () => facilities.find((candidate) => candidate.id === facilityId),
    [facilities, facilityId],
  );

  useEffect(() => {
    setFacilityId(facilities[0]?.id ?? "");
  }, [facilities]);

  useEffect(() => {
    if (!facilityId) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await listBookingsAction({ date, facilityId });
        if (!cancelled) setRows(result);
      } catch {
        if (!cancelled) setError("Could not load the day board.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [facilityId, date, refreshKey]);

  async function cancel(row: BookingDayRow) {
    setBusyId(row.bookingId);
    setError(null);
    try {
      const result = await cancelBookingAction({ bookingId: row.bookingId });
      if (!result.ok) setError(result.error);
      else setRefreshKey((key) => key + 1);
    } catch {
      setError("The booking could not be cancelled. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function requestBill(row: BookingDayRow) {
    setBusyId(row.bookingId);
    setError(null);
    try {
      const result = await requestBookingBillAction({
        bookingId: row.bookingId,
      });
      if (!result.ok) setError(result.error);
      else setBill(result.bill);
    } catch {
      setError("The bill could not be raised. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  function resetBill() {
    setBill(null);
    setPaid(false);
    setRefreshKey((key) => key + 1);
  }

  if (bill && paid) {
    return (
      <BookingReceipt bill={bill} method={paidMethod} onReset={resetBill} />
    );
  }
  if (bill) {
    return (
      <div className="space-y-4">
        {error ? <ErrorNote message={error} /> : null}
        <BookingBillPanel
          bill={bill}
          onPaid={(method) => {
            setPaidMethod(method);
            setPaid(true);
          }}
          onBack={resetBill}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BookingForm
        facilities={facilities}
        timezone={timezone}
        today={today}
        terminology={terminology}
        facilityId={facilityId}
        onFacilityChange={setFacilityId}
        date={date}
        onDateChange={setDate}
        onCreated={() => setRefreshKey((key) => key + 1)}
      />

      <section className="rounded-card border border-line bg-paper p-4">
        <h2 className="font-display text-[15px] font-semibold text-ink">
          {selectedFacility?.name ?? "Day board"}
        </h2>
        {error ? <ErrorNote message={error} /> : null}
        <div className="mt-3">
          <BookingDayList
            rows={rows}
            busyId={busyId}
            onCancel={cancel}
            onBill={requestBill}
          />
        </div>
      </section>
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="mt-3 rounded-ctl border border-line bg-warn-soft px-3 py-2 text-[13px] text-ink"
      data-testid="booking-error"
    >
      {message}
    </p>
  );
}
